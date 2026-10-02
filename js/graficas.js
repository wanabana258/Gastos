/* ============================================================
 * graficas.js — Gráficos del mes (sin librerías, funcionan offline)
 *
 * Ambas funciones reciben la lista de categorías con gasto, ya ordenada
 * de mayor a menor: [{ id, nombre, emoji, color, cent }, ...]
 * y devuelven un trozo de HTML. Cada fila es un botón con
 * data-accion="filtrar-cat" para saltar al historial de esa categoría.
 *
 * El donut se dibuja con círculos SVG: cada categoría es un círculo con
 * stroke-dasharray, que pinta solo un trozo del contorno (el "arco").
 * ============================================================ */

import { esc, formatearEuros } from './utils.js';

/** 0.4237 → "42 %" (con espacio fino, como se escribe en español) */
const porcentaje = (parte, total) => `${Math.round((parte / total) * 100)}\u00a0%`;

/* ---------- Donut + leyenda ---------- */
export function htmlDonut(categorias, total) {
  const R = 46;                        // radio del círculo (viewBox de 120×120)
  const C = 2 * Math.PI * R;           // longitud de la circunferencia
  const hayVarias = categorias.length > 1;
  let acumulado = 0;

  const arcos = categorias
    .map((c) => {
      const largo = (c.cent / total) * C;
      const hueco = hayVarias ? Math.min(1.4, largo * 0.35) : 0; // separación entre arcos
      const trazo = Math.max(largo - hueco, 0.01);
      const arco = `<circle cx="60" cy="60" r="${R}" fill="none" stroke="${c.color}" stroke-width="15"
        stroke-dasharray="${trazo.toFixed(2)} ${(C - trazo).toFixed(2)}"
        stroke-dashoffset="${(-acumulado).toFixed(2)}" transform="rotate(-90 60 60)"/>`;
      acumulado += largo;
      return arco;
    })
    .join('');

  const mayor = categorias[0];

  const filas = categorias
    .map(
      (c) => `
      <li>
        <button type="button" class="fila" data-accion="filtrar-cat" data-cat="${c.id}">
          <span class="punto" style="background:${c.color}"></span>
          <span class="fila-texto">${c.emoji} ${esc(c.nombre)}</span>
          <span class="fila-importe">${formatearEuros(c.cent)}</span>
          <span class="fila-pct">${porcentaje(c.cent, total)}</span>
        </button>
      </li>`,
    )
    .join('');

  return `
    <div class="donut" role="img" aria-label="Gasto por categoría. Mayor gasto: ${esc(mayor.nombre)}, ${porcentaje(mayor.cent, total)}">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="${R}" fill="none" stroke="var(--linea)" stroke-width="15" opacity=".35"/>
        ${arcos}
      </svg>
      <div class="donut-centro">
        <span class="donut-emoji">${mayor.emoji}</span>
        <span class="donut-pct">${porcentaje(mayor.cent, total)}</span>
        <span class="donut-nombre">${esc(mayor.nombre)}</span>
      </div>
    </div>
    <ul class="lista-cat">${filas}</ul>`;
}

/* ---------- Barras horizontales ---------- */
export function htmlBarras(categorias, total) {
  const max = categorias[0].cent; // la mayor ocupa el 100 % del ancho

  const filas = categorias
    .map(
      (c) => `
      <li>
        <button type="button" class="barra" data-accion="filtrar-cat" data-cat="${c.id}">
          <span class="barra-nombre">${c.emoji} ${esc(c.nombre)}</span>
          <span class="barra-valor">${formatearEuros(c.cent)} <small>${porcentaje(c.cent, total)}</small></span>
          <span class="barra-pista">
            <span class="barra-relleno" style="width:${Math.max((c.cent / max) * 100, 2).toFixed(1)}%;background:${c.color}"></span>
          </span>
        </button>
      </li>`,
    )
    .join('');

  return `<ul class="lista-barras">${filas}</ul>`;
}
