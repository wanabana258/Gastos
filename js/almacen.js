/* ============================================================
 * almacen.js — Persistencia local (localStorage)
 *
 * Decisión técnica: localStorage basta de sobra aquí (unos pocos KB
 * al año) y es síncrono, lo que simplifica mucho el código. Si algún día
 * tuvieras decenas de miles de gastos, este es el único archivo que
 * habría que cambiar por IndexedDB: el resto de la app solo usa las
 * funciones exportadas abajo.
 *
 * Estructura guardada (una sola clave, en JSON):
 *   {
 *     version: 1,
 *     gastos: [{ id, cent, concepto, cat, metodo, fecha, creado }],
 *     aprendido: { "ramen": "comida", ... },     // palabra → categoría
 *     prefs: { metodo: "cuenta", grafica: "circular" }
 *   }
 *   - cent: importe en céntimos (entero)
 *   - metodo: "cuenta" | "efectivo"
 *   - fecha: "AAAA-MM-DD"        - creado: marca de tiempo (ms)
 * ============================================================ */

import { categoriaPorId } from './categorias.js';
import { crearId } from './utils.js';

const CLAVE = 'gastos-app/datos-v1';

const datosVacios = () => ({
  version: 1,
  gastos: [],
  aprendido: {},
  prefs: { metodo: 'cuenta', grafica: 'circular' },
});

let datos = cargar();

/* ---------- Carga y guardado ---------- */

function cargar() {
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (!crudo) return datosVacios();
    const d = JSON.parse(crudo);
    const base = datosVacios();
    return {
      ...base,
      ...d,
      gastos: Array.isArray(d.gastos) ? d.gastos : [],
      aprendido: d.aprendido && typeof d.aprendido === 'object' ? d.aprendido : {},
      prefs: { ...base.prefs, ...(d.prefs || {}) },
    };
  } catch (error) {
    // Si los datos están corruptos, no los perdemos: los apartamos en otra clave.
    console.error('Datos ilegibles, se apartan una copia:', error);
    try { localStorage.setItem(`${CLAVE}-corrupto`, localStorage.getItem(CLAVE) ?? ''); } catch { /* nada */ }
    return datosVacios();
  }
}

function persistir() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(datos));
    return true;
  } catch (error) {
    console.error('No se pudo guardar:', error);
    window.dispatchEvent(new CustomEvent('almacen-error'));
    return false;
  }
}

/* ---------- Gastos ---------- */

export const todosLosGastos = () => datos.gastos;

/** Gastos de un mes ("AAAA-MM"), los más recientes primero. */
export function gastosDelMes(mes) {
  return datos.gastos
    .filter((g) => g.fecha.startsWith(mes))
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado - a.creado);
}

export const obtenerGasto = (id) => datos.gastos.find((g) => g.id === id);

/** Crea un gasto nuevo y lo devuelve (con su id). */
export function agregarGasto({ cent, concepto, cat, metodo, fecha }) {
  const gasto = { id: crearId(), cent, concepto, cat, metodo, fecha, creado: Date.now() };
  datos.gastos.push(gasto);
  persistir();
  return gasto;
}

export function actualizarGasto(id, cambios) {
  const g = obtenerGasto(id);
  if (g) Object.assign(g, cambios);
  persistir();
}

/** Borra un gasto y lo devuelve (para poder deshacer). */
export function eliminarGasto(id) {
  const i = datos.gastos.findIndex((g) => g.id === id);
  if (i < 0) return null;
  const [borrado] = datos.gastos.splice(i, 1);
  persistir();
  return borrado;
}

/** Vuelve a insertar un gasto borrado (deshacer). */
export function restaurarGasto(gasto) {
  if (!obtenerGasto(gasto.id)) datos.gastos.push(gasto);
  persistir();
}

/* ---------- Palabras aprendidas ---------- */

export const aprendido = () => datos.aprendido;
export const guardarAprendido = () => persistir();

export function olvidarPalabra(palabra) {
  delete datos.aprendido[palabra];
  persistir();
}

/* ---------- Preferencias (último método de pago, tipo de gráfica) ---------- */

export const preferencia = (nombre) => datos.prefs[nombre];
export function guardarPreferencia(nombre, valor) {
  datos.prefs[nombre] = valor;
  persistir();
}

/* ---------- Copia de seguridad e importación ---------- */

/** Texto JSON con TODO (gastos + palabras aprendidas). */
export function copiaCompletaJSON() {
  return JSON.stringify(
    { app: 'gastos', version: 1, exportado: new Date().toISOString(), gastos: datos.gastos, aprendido: datos.aprendido },
    null,
    2,
  );
}

/** Lee un archivo JSON de copia de seguridad. Lanza Error si no es válido. */
export function leerCopiaJSON(texto) {
  let d;
  try { d = JSON.parse(texto); } catch { throw new Error('El archivo no es un JSON válido.'); }
  if (!d || !Array.isArray(d.gastos)) throw new Error('El archivo no parece una copia de esta app.');
  return { gastos: d.gastos, aprendido: d.aprendido ?? {} };
}

/** Comprueba y limpia un gasto importado. Devuelve null si no sirve. */
function sanearGasto(g) {
  if (!g || typeof g !== 'object') return null;
  const cent = Math.round(Number(g.cent));
  const fecha = String(g.fecha ?? '');
  if (!Number.isFinite(cent) || cent <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  return {
    id: typeof g.id === 'string' && g.id ? g.id : null, // null = hay que asignarle uno
    cent,
    concepto: String(g.concepto ?? '').trim() || 'Sin concepto',
    cat: categoriaPorId(g.cat).id,
    metodo: g.metodo === 'efectivo' ? 'efectivo' : 'cuenta',
    fecha,
    creado: Number.isFinite(g.creado) ? g.creado : Date.now(),
  };
}

const claveGasto = (g) => `${g.fecha}|${g.cent}|${g.concepto.toLowerCase()}|${g.metodo}`;

/**
 * Mezcla gastos importados con los existentes SIN duplicar:
 *  - si traen id, se compara por id;
 *  - si no (CSV hecho a mano), se compara por fecha+importe+concepto+método
 *    contra lo que YA había antes de importar.
 * @returns {{agregados:number, repetidos:number, invalidos:number}}
 */
export function fusionar({ gastos = [], aprendido: nuevasPalabras = {} }) {
  const ids = new Set(datos.gastos.map((g) => g.id));
  const clavesPrevias = new Set(datos.gastos.map(claveGasto));
  let agregados = 0, repetidos = 0, invalidos = 0;

  for (const crudo of gastos) {
    const g = sanearGasto(crudo);
    if (!g) { invalidos++; continue; }
    const duplicado = g.id ? ids.has(g.id) : clavesPrevias.has(claveGasto(g));
    if (duplicado) { repetidos++; continue; }
    g.id ??= crearId();
    ids.add(g.id);
    datos.gastos.push(g);
    agregados++;
  }
  // Las palabras aprendidas que ya tenías no se pisan
  for (const [palabra, cat] of Object.entries(nuevasPalabras)) {
    if (!Object.hasOwn(datos.aprendido, palabra) && categoriaPorId(cat).id === cat) datos.aprendido[palabra] = cat;
  }
  persistir();
  return { agregados, repetidos, invalidos };
}
