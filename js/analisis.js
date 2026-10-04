/* ============================================================
 * analisis.js — Comparativa entre meses, «¿Qué podría recortar?» y límites
 *
 * Código PURO (sin pantalla ni localStorage): recibe listas de gastos y
 * devuelve números, para poder probarlo aislado. app.js lo dibuja.
 *
 * Importes siempre en céntimos. Un gasto es { cent, cat, fecha, pagoId?, ... }.
 * ============================================================ */

import { CATEGORIAS } from './categorias.js';

/** "2026-09" → "septiembre" (para frases como «frente a septiembre») */
export function mesSolo(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('es-ES', { month: 'long' });
}

/** Mapa categoría → céntimos gastados. */
export function sumarPorCategoria(gastos) {
  const suma = new Map();
  for (const g of gastos) suma.set(g.cat, (suma.get(g.cat) ?? 0) + g.cent);
  return suma;
}

/** De lo gastado en cada categoría, cuánto viene de pagos fijos (gastos con `pagoId`). */
export function fijosPorCategoria(gastos) {
  return sumarPorCategoria(gastos.filter((g) => g.pagoId));
}

/**
 * Compara dos listas de gastos (mes actual y mes anterior) categoría por categoría.
 * Devuelve { filas, totalActual, totalAnterior, delta, pct } con las filas ordenadas de la que
 * más ha subido a la que más ha bajado. `pct` es null si el mes anterior fue 0.
 */
export function comparar(actuales, anteriores) {
  const a = sumarPorCategoria(actuales);
  const b = sumarPorCategoria(anteriores);
  const filas = [...new Set([...a.keys(), ...b.keys()])].map((cat) => {
    const actual = a.get(cat) ?? 0;
    const anterior = b.get(cat) ?? 0;
    const delta = actual - anterior;
    return { cat, actual, anterior, delta, pct: anterior > 0 ? delta / anterior : null };
  });
  filas.sort((x, y) => y.delta - x.delta || y.actual - x.actual);

  const totalActual = filas.reduce((t, f) => t + f.actual, 0);
  const totalAnterior = filas.reduce((t, f) => t + f.anterior, 0);
  const delta = totalActual - totalAnterior;
  return { filas, totalActual, totalAnterior, delta, pct: totalAnterior > 0 ? delta / totalAnterior : null };
}

/** Las N categorías donde más se gasta (de mayor a menor). */
export const topCategorias = (filas, n = 3) =>
  filas.filter((f) => f.actual > 0).sort((x, y) => y.actual - x.actual).slice(0, n);

/**
 * Las categorías que más han crecido respecto al mes anterior.
 * Para no avisar por tonterías, hace falta subir al menos `minimoCent` Y al menos `minimoPct`
 * (una categoría que no existía el mes pasado cuenta como subida si pasa del mínimo en euros).
 */
export function mayoresSubidas(filas, n = 3, minimoCent = 500, minimoPct = 0.1) {
  return filas
    .filter((f) => f.delta >= minimoCent && (f.pct === null || f.pct >= minimoPct))
    .sort((x, y) => y.delta - x.delta)
    .slice(0, n);
}

/* ---------- Límites por categoría ---------- */

/** Estado de un límite: porcentaje de la barra (máx. 100), lo que queda y si se ha pasado o está cerca (≥ 80 %). */
export function estadoLimite(gastado, limite) {
  const ratio = limite > 0 ? gastado / limite : 0;
  return {
    ratio,
    pct: Math.min(100, Math.round(ratio * 100)),
    restante: limite - gastado,
    excedido: gastado > limite,
    cerca: gastado <= limite && ratio >= 0.8,
  };
}

const IDS_CATEGORIA = new Set(CATEGORIAS.map((c) => c.id));

/** Limpia { categoría: céntimos } que viene de fuera: solo categorías que existen e importes positivos. */
export function sanearLimites(obj) {
  const limpio = {};
  if (!obj || typeof obj !== 'object') return limpio;
  for (const [cat, valor] of Object.entries(obj)) {
    const cent = Math.round(Number(valor));
    if (IDS_CATEGORIA.has(cat) && Number.isFinite(cent) && cent > 0) limpio[cat] = cent;
  }
  return limpio;
}
