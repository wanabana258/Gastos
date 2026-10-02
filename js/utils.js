/* ============================================================
 * utils.js — Funciones auxiliares pequeñas (formato, fechas, DOM)
 *
 * Decisión técnica: los importes se guardan SIEMPRE en céntimos
 * (números enteros). Así evitamos los errores de coma flotante
 * (0.1 + 0.2 !== 0.3) al sumar. Solo convertimos a euros al mostrar.
 * ============================================================ */

const formatoEuros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
const formatoNumero = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 1250 (céntimos) → "12,50 €" */
export const formatearEuros = (cent) => formatoEuros.format(cent / 100);

/** 1250 → { entero: "12", decimales: "50" } (para pintar el total en grande) */
export function partesNumero(cent) {
  const [entero, decimales] = formatoNumero.format(cent / 100).split(',');
  return { entero, decimales };
}

/** 1250 → "12,50" (texto que se puede editar en un <input>) */
export const aTextoEditable = (cent) => (cent / 100).toFixed(2).replace('.', ',');

/** Pluralización simple: plural(2, 'gasto', 'gastos') → "2 gastos" */
export const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/* ---------- Fechas ----------
 * Las fechas se guardan como texto "AAAA-MM-DD" en hora LOCAL (no UTC),
 * para que un gasto de las 00:30 no caiga en el día anterior.
 * Los meses se identifican como "AAAA-MM".
 */
const pad = (n) => String(n).padStart(2, '0');

export function fechaISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const mesDe = (fecha) => fecha.slice(0, 7);
export const mesActual = () => mesDe(fechaISO());

/** desplazarMes("2026-10", -1) → "2026-09" */
export function desplazarMes(mes, delta) {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** "2026-10" → "Octubre 2026" */
export function nombreMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const nombre = new Date(a, m - 1, 1).toLocaleDateString('es-ES', { month: 'long' });
  return nombre.charAt(0).toUpperCase() + nombre.slice(1) + ' ' + a;
}

/** "2026-10-02" → "Hoy" / "Ayer" / "Mié, 30 sept" */
export function etiquetaDia(fecha) {
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  if (fecha === fechaISO(hoy)) return 'Hoy';
  if (fecha === fechaISO(ayer)) return 'Ayer';
  const [a, m, d] = fecha.split('-').map(Number);
  const t = new Date(a, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/* ---------- Seguridad y varios ---------- */

/** Escapa texto para meterlo en innerHTML sin riesgo (los conceptos los escribe el usuario). */
export const esc = (t) =>
  String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Identificador único para cada gasto. */
export function crearId() {
  return crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Descarga un texto como archivo (CSV, JSON...) desde el navegador. */
export function descargarArchivo(nombre, contenido, tipo) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
