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
 *     version: 2,
 *     gastos: [{ id, cent, concepto, cat, metodo, fecha, creado }],
 *     movimientos: [{ id, tipo, cent, concepto, metodo, destino?, fecha, creado }],
 *     saldos: null | { cuenta, efectivo, desde },
 *     aprendido: { "ramen": "comida", ... },     // palabra → categoría
 *     temas: [ ...temas de color creados o modificados por el usuario (ver temas.js) ],
 *     pagos: [ ...pagos fijos y recordatorios (ver pagos.js) ],
 *     limites: { "ocio": 6000, ... },           // tope mensual por categoría, en céntimos
 *     prefs: { metodo, grafica, tema, modo }
 *   }
 *   - cent: importe en céntimos (entero)
 *   - metodo: "cuenta" | "efectivo"
 *   - fecha: "AAAA-MM-DD"        - creado: marca de tiempo (ms)
 *   - gastos creados por un pago fijo llevan además `pagoId` (el id de ese pago)
 *   - movimientos: dinero que NO es un gasto:
 *       tipo "ingreso":  entra dinero en `metodo`
 *       tipo "traspaso": sale de `metodo` y entra en `destino` (p. ej. cajero: cuenta → efectivo)
 *
 * CÓMO SE CALCULA EL SALDO
 *   `saldos` guarda cuánto tenías en cada sitio en el momento `desde` (un
 *   instante, en ms). El saldo actual es ese punto de partida, menos los
 *   gastos, más los ingresos, ± los traspasos REGISTRADOS DESPUÉS de ese
 *   instante (se compara con `creado`, no con `fecha`). Así puedes apuntar
 *   un gasto de ayer hoy y restará igual, y los gastos antiguos que ya
 *   estaban en tu saldo real no se restan dos veces.
 *   "Corregir saldo" simplemente fija un nuevo punto de partida.
 * ============================================================ */

import { categoriaPorId } from './categorias.js';
import { crearId } from './utils.js';
import { sanearTema } from './temas.js';
import { sanearPago } from './pagos.js';
import { sanearLimites } from './analisis.js';

const CLAVE = 'gastos-app/datos-v1'; // se mantiene igual para no perder datos de la versión 1

const datosVacios = () => ({
  version: 2,
  gastos: [],
  movimientos: [],
  saldos: null,
  aprendido: {},
  temas: [],
  pagos: [],
  limites: {},
  prefs: { metodo: 'cuenta', grafica: 'circular', tema: 'tinta', modo: 'auto' },
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
      version: 2,
      gastos: Array.isArray(d.gastos) ? d.gastos : [],
      movimientos: Array.isArray(d.movimientos) ? d.movimientos : [],
      saldos: d.saldos && typeof d.saldos === 'object' ? d.saldos : null,
      aprendido: d.aprendido && typeof d.aprendido === 'object' ? d.aprendido : {},
      temas: (Array.isArray(d.temas) ? d.temas : []).map(sanearTema).filter(Boolean),
      pagos: (Array.isArray(d.pagos) ? d.pagos : []).map(sanearPago).filter(Boolean),
      limites: sanearLimites(d.limites),
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

/**
 * Crea un gasto nuevo y lo devuelve (con su id).
 * `pagoId` (opcional) lo vincula a un pago fijo; `creado` (opcional) fija la marca de tiempo
 * (los pagos automáticos la ponen en la fecha en que tocaban, ver pagos y saldos en app.js).
 */
export function agregarGasto({ cent, concepto, cat, metodo, fecha, pagoId, creado }) {
  const gasto = { id: crearId(), cent, concepto, cat, metodo, fecha, creado: creado ?? Date.now() };
  if (pagoId) gasto.pagoId = pagoId;
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

/* ---------- Movimientos (ingresos y traspasos) ---------- */

/** Todos los movimientos, los más recientes primero. */
export function listarMovimientos() {
  return [...datos.movimientos].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado - a.creado);
}

export const obtenerMovimiento = (id) => datos.movimientos.find((m) => m.id === id);

/** Crea un ingreso o un traspaso. Devuelve el movimiento con su id. */
export function agregarMovimiento({ tipo, cent, concepto, metodo, destino, fecha }) {
  const mov = { id: crearId(), tipo, cent, concepto, metodo, fecha, creado: Date.now() };
  if (tipo === 'traspaso') mov.destino = destino;
  datos.movimientos.push(mov);
  persistir();
  return mov;
}

export function actualizarMovimiento(id, cambios) {
  const m = obtenerMovimiento(id);
  if (m) Object.assign(m, cambios);
  persistir();
}

export function eliminarMovimiento(id) {
  const i = datos.movimientos.findIndex((m) => m.id === id);
  if (i < 0) return null;
  const [borrado] = datos.movimientos.splice(i, 1);
  persistir();
  return borrado;
}

export function restaurarMovimiento(mov) {
  if (!obtenerMovimiento(mov.id)) datos.movimientos.push(mov);
  persistir();
}

/* ---------- Saldos ---------- */

/** ¿El usuario ya ha apuntado cuánto tiene? (si no, la app funciona sin saldos) */
export const haySaldos = () => datos.saldos !== null;
export const saldoDesde = () => datos.saldos?.desde ?? null;

/**
 * Saldo actual: { cuenta, efectivo } en céntimos (puede ser negativo),
 * o null si aún no se han configurado los saldos.
 */
export function saldoActual() {
  const base = datos.saldos;
  if (!base) return null;
  const s = { cuenta: base.cuenta, efectivo: base.efectivo };
  for (const g of datos.gastos) {
    if (g.creado >= base.desde) s[g.metodo] -= g.cent;
  }
  for (const m of datos.movimientos) {
    if (m.creado < base.desde) continue;
    if (m.tipo === 'ingreso') s[m.metodo] += m.cent;
    else { s[m.metodo] -= m.cent; s[m.destino] += m.cent; }
  }
  return s;
}

/** Primera configuración: lo que tienes ahora en la cuenta y en efectivo (céntimos). */
export function configurarSaldos({ cuenta, efectivo }) {
  datos.saldos = { cuenta, efectivo, desde: Date.now() };
  persistir();
}

/** Corrige el saldo de UN sitio ('cuenta' | 'efectivo'); el otro conserva su valor actual. */
export function corregirSaldo(metodo, cent) {
  const actual = saldoActual() ?? { cuenta: 0, efectivo: 0 };
  datos.saldos = { ...actual, [metodo]: cent, desde: Date.now() };
  persistir();
}

/* ---------- Pagos fijos y recordatorios ---------- */

export const listarPagos = () => datos.pagos;
export const obtenerPago = (id) => datos.pagos.find((p) => p.id === id);

/** Guarda un pago (nuevo, o sustituye al que tenga el mismo id). */
export function guardarPago(pago) {
  const copia = JSON.parse(JSON.stringify(pago));
  const i = datos.pagos.findIndex((p) => p.id === copia.id);
  if (i >= 0) datos.pagos[i] = copia;
  else datos.pagos.push(copia);
  persistir();
}

/** Borra un pago y lo devuelve (para poder deshacer). Los gastos que ya generó se quedan en el historial. */
export function eliminarPago(id) {
  const i = datos.pagos.findIndex((p) => p.id === id);
  if (i < 0) return null;
  const [borrado] = datos.pagos.splice(i, 1);
  persistir();
  return borrado;
}

/** Marca una ocurrencia (mes «AAAA-MM») como resuelta: { gastoId } o { omitido: true }. Con null la reabre. */
export function marcarOcurrencia(idPago, mes, valor) {
  const p = obtenerPago(idPago);
  if (!p) return;
  p.hechas ??= {};
  if (valor) p.hechas[mes] = valor;
  else delete p.hechas[mes];
  persistir();
}

/** «Más tarde»: oculta la ocurrencia de la lista de pendientes hasta esa fecha. */
export function aplazarOcurrencia(idPago, mes, fecha) {
  const p = obtenerPago(idPago);
  if (!p) return;
  p.aplazado ??= {};
  p.aplazado[mes] = fecha;
  persistir();
}

/* ---------- Límites mensuales por categoría ---------- */

/** { categoría: céntimos }. Una categoría sin límite no aparece. */
export const limites = () => datos.limites;

/** Sustituye todos los límites (las categorías en blanco/0 se quitan). */
export function guardarLimites(nuevos) {
  datos.limites = sanearLimites(nuevos);
  persistir();
}

/* ---------- Palabras aprendidas ---------- */

export const aprendido = () => datos.aprendido;
export const guardarAprendido = () => persistir();

export function olvidarPalabra(palabra) {
  delete datos.aprendido[palabra];
  persistir();
}

/* ---------- Temas de color propios ---------- */

export const listarTemasPersonalizados = () => datos.temas;

/** Guarda un tema (nuevo, o sustituye al que tenga el mismo id). */
export function guardarTemaPersonalizado(tema) {
  const copia = JSON.parse(JSON.stringify(tema));
  const i = datos.temas.findIndex((t) => t.id === copia.id);
  if (i >= 0) datos.temas[i] = copia;
  else datos.temas.push(copia);
  persistir();
}

/** Borra un tema propio (si era una modificación de uno de fábrica, vuelve el original). */
export function eliminarTemaPersonalizado(id) {
  const i = datos.temas.findIndex((t) => t.id === id);
  if (i < 0) return null;
  const [borrado] = datos.temas.splice(i, 1);
  persistir();
  return borrado;
}

/* ---------- Preferencias (último método de pago, gráfica, tema) ---------- */

export const preferencia = (nombre) => datos.prefs[nombre];
export function guardarPreferencia(nombre, valor) {
  datos.prefs[nombre] = valor;
  persistir();
}

/* ---------- Copia de seguridad e importación ---------- */

/** Texto JSON con TODO (gastos, movimientos, saldos, pagos fijos, límites, palabras aprendidas y temas de color). */
export function copiaCompletaJSON() {
  return JSON.stringify(
    {
      app: 'gastos',
      version: 5,
      exportado: new Date().toISOString(),
      gastos: datos.gastos,
      movimientos: datos.movimientos,
      saldos: datos.saldos,
      aprendido: datos.aprendido,
      temas: datos.temas,
      pagos: datos.pagos,
      limites: datos.limites,
    },
    null,
    2,
  );
}

/** Lee un archivo JSON de copia de seguridad. Lanza Error si no es válido. */
export function leerCopiaJSON(texto) {
  let d;
  try { d = JSON.parse(texto); } catch { throw new Error('El archivo no es un JSON válido.'); }
  if (!d || !Array.isArray(d.gastos)) throw new Error('El archivo no parece una copia de esta app.');
  return {
    gastos: d.gastos,
    movimientos: Array.isArray(d.movimientos) ? d.movimientos : [],
    saldos: d.saldos ?? null,
    aprendido: d.aprendido ?? {},
    temas: Array.isArray(d.temas) ? d.temas : [],
    pagos: Array.isArray(d.pagos) ? d.pagos : [],
    limites: d.limites ?? {},
  };
}

/** Marca de tiempo razonable para filas importadas que no traen `creado` (mediodía de su fecha). */
const creadoDesdeFecha = (fecha) => new Date(`${fecha}T12:00:00`).getTime();

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
    // Sin `creado` (CSV hecho a mano) usamos su fecha: así no resta de un saldo ya configurado
    creado: Number.isFinite(g.creado) ? g.creado : creadoDesdeFecha(fecha),
    ...(typeof g.pagoId === 'string' && g.pagoId ? { pagoId: g.pagoId } : {}),
  };
}

/** Igual que sanearGasto, para ingresos y traspasos. */
function sanearMovimiento(m) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !m.id) return null;
  const cent = Math.round(Number(m.cent));
  const fecha = String(m.fecha ?? '');
  const tipo = m.tipo === 'traspaso' ? 'traspaso' : m.tipo === 'ingreso' ? 'ingreso' : null;
  if (!tipo || !Number.isFinite(cent) || cent <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  const metodo = m.metodo === 'efectivo' ? 'efectivo' : 'cuenta';
  const limpio = {
    id: m.id,
    tipo,
    cent,
    concepto: String(m.concepto ?? '').trim() || (tipo === 'ingreso' ? 'Ingreso' : 'Traspaso'),
    metodo,
    fecha,
    creado: Number.isFinite(m.creado) ? m.creado : creadoDesdeFecha(fecha),
  };
  if (tipo === 'traspaso') limpio.destino = metodo === 'cuenta' ? 'efectivo' : 'cuenta';
  return limpio;
}

const claveGasto = (g) => `${g.fecha}|${g.cent}|${g.concepto.toLowerCase()}|${g.metodo}`;

/**
 * Mezcla datos importados con los existentes SIN duplicar:
 *  - si traen id, se compara por id;
 *  - si no (CSV hecho a mano), se compara por fecha+importe+concepto+método
 *    contra lo que YA había antes de importar.
 * Los saldos del archivo solo se adoptan si este dispositivo aún no tiene los suyos.
 * Los temas de color y los pagos del archivo se añaden si aquí no existe otro con el mismo id.
 * Los límites del archivo solo rellenan las categorías que aquí aún no tienen límite.
 * @returns {{agregados:number, repetidos:number, invalidos:number, movimientos:number, saldosRestaurados:boolean, temas:number, pagos:number}}
 */
export function fusionar({ gastos = [], movimientos = [], saldos = null, aprendido: nuevasPalabras = {}, temas = [], pagos = [], limites: nuevosLimites = {} }) {
  const ids = new Set(datos.gastos.map((g) => g.id));
  const clavesPrevias = new Set(datos.gastos.map(claveGasto));
  let agregados = 0, repetidos = 0, invalidos = 0, movsNuevos = 0;

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

  const idsMov = new Set(datos.movimientos.map((m) => m.id));
  for (const crudo of movimientos) {
    const m = sanearMovimiento(crudo);
    if (!m) { invalidos++; continue; }
    if (idsMov.has(m.id)) { repetidos++; continue; }
    idsMov.add(m.id);
    datos.movimientos.push(m);
    movsNuevos++;
  }

  // Punto de partida de los saldos: solo si aquí no hay uno
  let saldosRestaurados = false;
  if (!datos.saldos && saldos && Number.isFinite(saldos.cuenta) && Number.isFinite(saldos.efectivo) && Number.isFinite(saldos.desde)) {
    datos.saldos = { cuenta: Math.round(saldos.cuenta), efectivo: Math.round(saldos.efectivo), desde: saldos.desde };
    saldosRestaurados = true;
  }

  // Las palabras aprendidas que ya tenías no se pisan
  for (const [palabra, cat] of Object.entries(nuevasPalabras)) {
    if (!Object.hasOwn(datos.aprendido, palabra) && categoriaPorId(cat).id === cat) datos.aprendido[palabra] = cat;
  }
  // Temas de color: solo los que aquí no existen
  let temasNuevos = 0;
  for (const crudo of temas) {
    const t = sanearTema(crudo);
    if (t && !datos.temas.some((x) => x.id === t.id)) { datos.temas.push(t); temasNuevos++; }
  }
  // Pagos fijos: solo los que aquí no existen
  let pagosNuevos = 0;
  for (const crudo of pagos) {
    const pago = sanearPago(crudo);
    if (pago && !datos.pagos.some((x) => x.id === pago.id)) { datos.pagos.push(pago); pagosNuevos++; }
  }
  // Límites: solo las categorías que aquí no tienen
  let limitesNuevos = 0;
  for (const [cat, cent] of Object.entries(sanearLimites(nuevosLimites))) {
    if (!Object.hasOwn(datos.limites, cat)) { datos.limites[cat] = cent; limitesNuevos++; }
  }
  persistir();
  return { agregados, repetidos, invalidos, movimientos: movsNuevos, saldosRestaurados, temas: temasNuevos, pagos: pagosNuevos, limites: limitesNuevos };
}
