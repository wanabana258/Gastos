/* ============================================================
 * pagos.js — Lógica de los pagos fijos y recordatorios
 *
 * Es código PURO: no toca la pantalla ni localStorage, solo recibe datos y
 * devuelve resultados. Por eso lo usan a la vez la app (app.js) y el
 * service worker (service-worker.js, que comprueba avisos con la app cerrada).
 *
 * Un PAGO es una plantilla; cada vez que toca pagarlo es una OCURRENCIA:
 *   {
 *     id, concepto, cent, cat, metodo,          // qué se paga y de dónde sale
 *     frecuencia: 'mensual' | 'unico',
 *     dia,                                       // mensual: día del mes (en meses cortos se usa el último día)
 *     inicio: 'AAAA-MM',                         // mensual: primer mes
 *     fecha: 'AAAA-MM-DD',                       // fecha del primer pago (único: la fecha del pago)
 *     modo: 'auto' | 'manual',                   // auto = «domiciliado»: se apunta solo ese día
 *                                                // manual = lo pagas tú (Bizum...): la app te avisa y confirmas
 *     aviso: null | 0 | 1 | 2 | 3 | 7,           // días de antelación del aviso (null = sin aviso del móvil)
 *     pausado: boolean,
 *     excepciones: { 'AAAA-MM': { omitir: true } | { cent: 4500 } },   // cambios SOLO para ese mes
 *     hechas:      { 'AAAA-MM': { gastoId } | { omitido: true } },     // ocurrencias ya resueltas
 *     aplazado:    { 'AAAA-MM': 'AAAA-MM-DD' },                        // «más tarde»: oculto hasta esa fecha
 *   }
 * Cada ocurrencia se identifica por su mes ('AAAA-MM'). Una vez resuelta
 * (apuntada u omitida) queda en `hechas` y NO se vuelve a generar, aunque
 * borres el gasto que creó.
 * ============================================================ */

import { desplazarMes, formatearEuros } from './utils.js';
import { categoriaPorId } from './categorias.js';

/* ---------- Fechas (todas como texto «AAAA-MM-DD», sin zonas horarias) ---------- */

const pad = (n) => String(n).padStart(2, '0');
const aDias = (iso) => {
  const [a, m, d] = iso.split('-').map(Number);
  return Date.UTC(a, m - 1, d) / 86400000;
};

/** Días que hay de `desde` a `hasta` (negativo si `hasta` es anterior). */
export const diasEntre = (desde, hasta) => Math.round(aDias(hasta) - aDias(desde));

export function sumarDias(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const f = new Date(Date.UTC(a, m - 1, d + n));
  return `${f.getUTCFullYear()}-${pad(f.getUTCMonth() + 1)}-${pad(f.getUTCDate())}`;
}

export const diasEnMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
};

/* ---------- Ocurrencias ---------- */

const mesInicial = (pago) => (pago.frecuencia === 'unico' ? pago.fecha.slice(0, 7) : pago.inicio);

/** Fecha en la que toca pagar este pago en ese mes (los días 29-31 se ajustan en meses cortos). */
export function fechaDeOcurrencia(pago, mes) {
  if (pago.frecuencia === 'unico') return pago.fecha;
  return `${mes}-${pad(Math.min(pago.dia, diasEnMes(mes)))}`;
}

/** Todos los meses en que hay ocurrencia, desde el primero hasta `mesLimite` (incluido). */
export function mesesHasta(pago, mesLimite) {
  const primero = mesInicial(pago);
  if (pago.frecuencia === 'unico') return primero <= mesLimite ? [primero] : [];
  const meses = [];
  for (let m = primero; m <= mesLimite; m = desplazarMes(m, 1)) meses.push(m);
  return meses;
}

/**
 * Ocurrencias SIN resolver cuya fecha llega como mucho a `hoy + horizonte` días.
 * Incluye las vencidas. No devuelve nada si el pago está pausado.
 */
export function ocurrencias(pago, hoy, horizonte = 0) {
  if (pago.pausado) return [];
  const limite = sumarDias(hoy, horizonte);
  const salida = [];
  for (const mes of mesesHasta(pago, limite.slice(0, 7))) {
    if (pago.hechas?.[mes]) continue;
    const fecha = fechaDeOcurrencia(pago, mes);
    if (fecha > limite) continue;
    const excepcion = pago.excepciones?.[mes];
    salida.push({
      pago,
      mes,
      fecha,
      cent: excepcion?.cent ?? pago.cent,
      omitida: Boolean(excepcion?.omitir),
      dias: diasEntre(hoy, fecha), // 0 = hoy, negativo = vencida, positivo = faltan
    });
  }
  return salida;
}

/**
 * Lo que hay que hacer / enseñar HOY con todos los pagos:
 *   automaticas  pagos «se apunta solo» que ya tocan y hay que registrar
 *   omitidas     ocurrencias que tú marcaste como «omitir» y ya les toca (solo hay que cerrarlas)
 *   pendientes   pagos «lo pago yo» que ya están en su ventana de aviso (o vencidos)
 *   avisos       pagos automáticos que se cobrarán pronto (aviso previo, sin acción)
 *   proximas     todo lo que viene en los próximos 45 días (sin repetir los pendientes)
 */
export function calcularEstado(pagos, hoy) {
  const estado = { automaticas: [], omitidas: [], pendientes: [], avisos: [], proximas: [] };

  for (const pago of pagos) {
    for (const o of ocurrencias(pago, hoy, 45)) {
      if (o.omitida) {
        if (o.dias <= 0) estado.omitidas.push(o);
        continue;
      }
      const ventana = pago.aviso ?? 0;
      if (pago.modo === 'auto') {
        if (o.dias <= 0) { estado.automaticas.push(o); continue; }
        if (pago.aviso != null && o.dias <= ventana) estado.avisos.push(o);
        estado.proximas.push(o);
      } else {
        const aplazadoHasta = pago.aplazado?.[o.mes] ?? '';
        if (o.dias <= ventana) {
          if (aplazadoHasta <= hoy) estado.pendientes.push(o);
        } else {
          estado.proximas.push(o);
        }
      }
    }
  }
  const porFecha = (a, b) => a.fecha.localeCompare(b.fecha) || a.pago.concepto.localeCompare(b.pago.concepto);
  for (const lista of Object.values(estado)) lista.sort(porFecha);
  return estado;
}

/**
 * Las próximas ocurrencias sin resolver de un pago (para editarlas mes a mes).
 * Salta las que vencieron hace más de dos meses.
 */
export function proximasEditables(pago, hoy, cuantas = 6) {
  const salida = [];
  const corte = sumarDias(hoy, -62);
  for (const mes of mesesHasta(pago, desplazarMes(hoy.slice(0, 7), 24))) {
    if (pago.hechas?.[mes]) continue;
    const fecha = fechaDeOcurrencia(pago, mes);
    if (fecha < corte) continue;
    const excepcion = pago.excepciones?.[mes];
    salida.push({ mes, fecha, cent: excepcion?.cent ?? pago.cent, omitida: Boolean(excepcion?.omitir) });
    if (salida.length >= cuantas) break;
  }
  return salida;
}

/** Siguiente fecha en que se pagará (o null si ya no queda ninguna o está pausado). */
export function proximaFecha(pago, hoy) {
  if (pago.pausado) return null;
  return proximasEditables(pago, hoy, 12).find((o) => !o.omitida && o.fecha >= hoy)?.fecha ?? null;
}

/* ---------- Textos ---------- */

export const ETIQUETAS_AVISO = { 0: 'El mismo día', 1: '1 día antes', 2: '2 días antes', 3: '3 días antes', 7: '1 semana antes' };

/** «Cada mes, día 5» / «Una vez» */
export const describirFrecuencia = (pago) => (pago.frecuencia === 'unico' ? 'Una sola vez' : `Cada mes, día ${pago.dia}`);

/** «5 nov» */
export function fechaCorta(iso) {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(a, m - 1, d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace('.', '');
}

/** «hoy», «mañana», «en 3 días», «venció hace 2 días» */
export function cuando(dias) {
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'mañana';
  if (dias > 1) return `en ${dias} días`;
  if (dias === -1) return 'venció ayer';
  return `venció hace ${-dias} días`;
}

/* ---------- Validación (copias de seguridad y datos guardados) ---------- */

const esMes = (m) => /^\d{4}-\d{2}$/.test(m);
const esFecha = (f) => /^\d{4}-\d{2}-\d{2}$/.test(f);

/** Limpia un pago que viene de fuera. Devuelve null si no sirve. */
export function sanearPago(p) {
  if (!p || typeof p !== 'object' || !/^[\w-]{1,60}$/.test(String(p.id ?? ''))) return null;
  const cent = Math.round(Number(p.cent));
  const fecha = String(p.fecha ?? '');
  if (!Number.isFinite(cent) || cent <= 0 || !esFecha(fecha)) return null;

  const unico = p.frecuencia === 'unico';
  const dia = unico ? Number(fecha.slice(8)) : Math.min(31, Math.max(1, Math.round(Number(p.dia)) || Number(fecha.slice(8))));
  const aviso = [0, 1, 2, 3, 7].includes(Number(p.aviso)) && p.aviso !== null && p.aviso !== '' ? Number(p.aviso) : null;

  const excepciones = {};
  for (const [mes, e] of Object.entries(p.excepciones ?? {})) {
    if (!esMes(mes) || !e || typeof e !== 'object') continue;
    if (e.omitir) excepciones[mes] = { omitir: true };
    else if (Number.isFinite(Math.round(Number(e.cent))) && Math.round(Number(e.cent)) > 0) excepciones[mes] = { cent: Math.round(Number(e.cent)) };
  }
  const hechas = {};
  for (const [mes, h] of Object.entries(p.hechas ?? {})) {
    if (!esMes(mes) || !h || typeof h !== 'object') continue;
    hechas[mes] = h.omitido ? { omitido: true } : { gastoId: typeof h.gastoId === 'string' ? h.gastoId : null };
  }
  const aplazado = {};
  for (const [mes, f] of Object.entries(p.aplazado ?? {})) if (esMes(mes) && esFecha(String(f))) aplazado[mes] = String(f);

  return {
    id: String(p.id),
    concepto: String(p.concepto ?? '').trim().slice(0, 60) || 'Pago',
    cent,
    cat: categoriaPorId(p.cat).id,
    metodo: p.metodo === 'efectivo' ? 'efectivo' : 'cuenta',
    frecuencia: unico ? 'unico' : 'mensual',
    dia,
    inicio: esMes(String(p.inicio ?? '')) ? String(p.inicio) : fecha.slice(0, 7),
    fecha,
    modo: p.modo === 'manual' ? 'manual' : 'auto',
    aviso,
    pausado: Boolean(p.pausado),
    excepciones,
    hechas,
    aplazado,
    creado: Number.isFinite(p.creado) ? p.creado : Date.now(),
  };
}

/* ---------- Exportar al calendario del móvil (.ics) ----------
 * Es la forma FIABLE de recibir avisos a su hora: el calendario de Android
 * se encarga de la alarma aunque esta app esté cerrada.
 */

const escapar = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Parte las líneas largas como exige el formato (sin cortar letras con tilde ni emojis). */
function plegar(linea) {
  const letras = Array.from(linea);
  if (letras.length <= 70) return linea;
  const trozos = [];
  for (let i = 0; i < letras.length; i += 70) trozos.push(letras.slice(i, i + 70).join(''));
  return trozos.join('\r\n ');
}

const sinGuiones = (iso) => iso.replace(/-/g, '');

/** Un único archivo .ics con todos los pagos que reciba. Los pagos ya terminados se saltan. */
export function generarICS(pagos, hoy, ahora = new Date()) {
  const sello = ahora.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lineas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mis gastos//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Pagos'];

  for (const pago of pagos) {
    let primera = proximaFecha(pago, hoy);
    if (!primera) {
      if (pago.frecuencia === 'unico') continue; // un pago único ya pasado no tiene sentido en el calendario
      primera = fechaDeOcurrencia(pago, desplazarMes(hoy.slice(0, 7), 1));
    }
    const fin = pago.dia > 28; // 29, 30 y 31 → último día de cada mes
    const inicio = fin && pago.frecuencia === 'mensual' ? `${primera.slice(0, 7)}-${pad(diasEnMes(primera.slice(0, 7)))}` : primera;
    const resumen = `${pago.modo === 'manual' ? 'Pagar' : 'Se cobra'}: ${pago.concepto} (${formatearEuros(pago.cent)})`;
    const nota = pago.modo === 'manual'
      ? 'Tienes que pagarlo tú. Apúntalo en la app Mis gastos al hacerlo.'
      : 'Se apunta solo en la app Mis gastos.';

    lineas.push(
      'BEGIN:VEVENT',
      `UID:${pago.id}@gastos-app`,
      `DTSTAMP:${sello}`,
      `DTSTART:${sinGuiones(inicio)}T090000`,
      `DTEND:${sinGuiones(inicio)}T091500`,
      `SUMMARY:${escapar(resumen)}`,
      `DESCRIPTION:${escapar(nota)}`,
    );
    if (pago.frecuencia === 'mensual') lineas.push(`RRULE:FREQ=MONTHLY;BYMONTHDAY=${fin ? -1 : pago.dia}`);
    if (pago.aviso) {
      lineas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapar(resumen)}`, `TRIGGER:-P${pago.aviso}D`, 'END:VALARM');
    }
    lineas.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapar(resumen)}`, 'TRIGGER:PT0S', 'END:VALARM', 'END:VEVENT');
  }
  lineas.push('END:VCALENDAR');
  return lineas.map(plegar).join('\r\n') + '\r\n';
}
