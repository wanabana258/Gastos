/* ============================================================
 * csv.js — Exportar e importar gastos en CSV
 *
 * Formato pensado para abrirlo directamente con Excel/Sheets en España:
 *   - separador ";" y decimales con coma ("12,50")
 *   - codificación UTF-8 con BOM (para que se vean bien las tildes y el €)
 *
 * Columnas: id;fecha;importe;concepto;categoria;metodo
 *
 * Al importar se aceptan también archivos hechos a mano: el separador se
 * detecta solo (; o ,), la columna "id" es opcional y la fecha puede ser
 * AAAA-MM-DD o DD/MM/AAAA.
 * ============================================================ */

import { CATEGORIAS, categoriaPorId, normalizar } from './categorias.js';
import { parseImporte } from './parser.js';
import { aTextoEditable } from './utils.js';

const SEP = ';';
const COLUMNAS = ['id', 'fecha', 'importe', 'concepto', 'categoria', 'metodo'];

/* ---------- Exportar ---------- */

/** Escapa una celda: si lleva ; " o saltos de línea, va entre comillas. */
const celda = (v) => {
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function generarCSV(gastos) {
  const ordenados = [...gastos].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creado - b.creado);
  const filas = ordenados.map((g) =>
    [
      g.id,
      g.fecha,
      aTextoEditable(g.cent),
      g.concepto,
      categoriaPorId(g.cat).nombre,
      g.metodo === 'efectivo' ? 'Efectivo' : 'Cuenta',
    ]
      .map(celda)
      .join(SEP),
  );
  return '\ufeff' + [COLUMNAS.join(SEP), ...filas].join('\r\n') + '\r\n';
}

/* ---------- Importar ---------- */

/** Divide el texto en filas de celdas respetando las comillas. */
function dividirFilas(texto, sep) {
  const filas = [];
  let fila = [];
  let actual = '';
  let entreComillas = false;

  const cerrarFila = () => {
    fila.push(actual);
    actual = '';
    if (fila.some((c) => c.trim() !== '')) filas.push(fila); // ignora filas vacías
    fila = [];
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { actual += '"'; i++; } // comilla escapada ""
        else entreComillas = false;
      } else actual += c;
    } else if (c === '"') entreComillas = true;
    else if (c === sep) { fila.push(actual); actual = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      cerrarFila();
    } else actual += c;
  }
  cerrarFila();
  return filas;
}

/** "2026-10-02" o "2/10/2026" → "2026-10-02" (o null si no es una fecha válida) */
function fechaAISO(texto) {
  let a, m, d;
  let r = texto.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (r) [, a, m, d] = r;
  else if ((r = texto.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/))) [, d, m, a] = r;
  else return null;
  if (+m < 1 || +m > 12 || +d < 1 || +d > 31) return null;
  return `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Nombre de categoría (normalizado) → id. Ej: "comida fuera" → "comida"
const NOMBRE_A_ID = new Map(CATEGORIAS.flatMap((c) => [[normalizar(c.nombre), c.id], [c.id, c.id]]));

// Nombres alternativos de columnas que aceptamos en la cabecera
const ALIAS = {
  id: ['id'],
  fecha: ['fecha', 'date'],
  importe: ['importe', 'cantidad', 'euros', 'amount'],
  concepto: ['concepto', 'descripcion', 'description'],
  categoria: ['categoria', 'category'],
  metodo: ['metodo', 'metodo de pago', 'pago', 'payment'],
};

/**
 * Convierte el texto de un CSV en gastos "en crudo" (aún sin validar del todo;
 * `fusionar` en almacen.js termina de limpiarlos). Lanza Error si el formato no sirve.
 */
export function parsearCSV(texto) {
  texto = texto.replace(/^\ufeff/, '');
  const primera = texto.split(/\r?\n/, 1)[0];
  const sep = primera.split(';').length >= primera.split(',').length ? ';' : ',';

  const filas = dividirFilas(texto, sep);
  if (filas.length < 2) throw new Error('El CSV está vacío o solo tiene la cabecera.');

  const cabecera = filas[0].map((c) => normalizar(c));
  const columna = (nombre) => cabecera.findIndex((c) => ALIAS[nombre].includes(c));
  const idx = Object.fromEntries(Object.keys(ALIAS).map((n) => [n, columna(n)]));

  if (idx.fecha < 0 || idx.importe < 0) {
    throw new Error('Faltan las columnas "fecha" e "importe" en la primera fila.');
  }

  const leer = (fila, nombre) => (idx[nombre] >= 0 ? (fila[idx[nombre]] ?? '').trim() : '');

  const gastos = filas.slice(1).map((fila) => {
    const cat = leer(fila, 'categoria');
    const metodo = normalizar(leer(fila, 'metodo'));
    return {
      id: leer(fila, 'id') || null,
      fecha: fechaAISO(leer(fila, 'fecha')) ?? '',
      cent: parseImporte(leer(fila, 'importe')) ?? NaN,
      concepto: leer(fila, 'concepto'),
      cat: NOMBRE_A_ID.get(normalizar(cat)) ?? 'otros',
      metodo: /efectivo|cash/.test(metodo) ? 'efectivo' : 'cuenta',
    };
  });

  return { gastos, aprendido: {} };
}
