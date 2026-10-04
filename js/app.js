/* ============================================================
 * app.js — Interfaz y flujo principal
 *
 * Mapa del archivo:
 *   1. Estado y referencias al DOM
 *   2. Vistas: cabecera, Resumen, Historial, Pagos, Cuentas, Ajustes, Editor de temas
 *   3. Hoja inferior (gasto, ingreso, traspaso, corregir saldo, pago fijo)
 *   4. Captura por frase (el campo de texto de abajo)
 *   5. Avisos (toast) y eventos globales
 *   6. Arranque (tema, service worker, instalación)
 *
 * Patrón usado: cada vista se "pinta" entera con una función render*()
 * que genera HTML, y los clics se gestionan por delegación de eventos
 * leyendo atributos data-accion. Es simple y suficiente para esta app.
 * ============================================================ */

import { CATEGORIAS, categoriaPorId, detectarCategoria, palabraAprendible, aprender } from './categorias.js';
import { interpretarFrase, parseImporte, parseSaldo } from './parser.js';
import * as almacen from './almacen.js';
import { generarCSV, parsearCSV } from './csv.js';
import { htmlDonut, htmlBarras } from './graficas.js';
import {
  MODOS, GRUPOS_COLOR, aplicarTema, vigilarSistema, esOscuro, muestraDe, variablesDe,
  listarTemas, temaPorId, registrarTemasPersonalizados, esDeFabrica, estaModificado, temaOriginal,
  temaCompleto, crearTemaNuevo, normalizarHex, avisosLegibilidad, ajustarTextos,
} from './temas.js';
import {
  calcularEstado, ocurrencias, proximasEditables, proximaFecha, sumarDias, describirFrecuencia,
  fechaCorta, cuando, ETIQUETAS_AVISO, generarICS,
} from './pagos.js';
import {
  mesSolo, fijosPorCategoria, comparar, topCategorias, mayoresSubidas, estadoLimite,
} from './analisis.js';
import { guardarKV } from './idb.js';
import {
  esc, fechaISO, mesDe, mesActual, desplazarMes, nombreMes, etiquetaDia, crearId,
  formatearEuros, partesNumero, aTextoEditable, plural, descargarArchivo,
} from './utils.js';

/* ============================================================
 * 1. Estado y referencias al DOM
 * ============================================================ */

const $ = (selector) => document.querySelector(selector);
const elCabecera = $('#cabecera');
const elVista = $('#vista');
const elFrase = $('#frase');
const elHoja = $('#hoja');
const elAviso = $('#aviso');
const elDock = $('.dock');

const estado = {
  vista: 'resumen',       // 'resumen' | 'historial' | 'pagos' | 'cuentas' | 'ajustes' | 'editor-tema'
  mes: mesActual(),       // mes que se está viendo ("AAAA-MM")
  filtroCat: '',          // id de categoría o '' (todas) — solo Historial
  filtroMetodo: '',       // 'cuenta' | 'efectivo' | '' (todos) — solo Historial
  instalador: null,       // evento "beforeinstallprompt" (para el botón Instalar)
  avisos: null,           // estado de las notificaciones del móvil (se lee al abrir la pestaña Pagos)
};

// Editor de temas: null si está cerrado; si no, { tema, esquema: 'claro'|'oscuro', abiertos: Set }
let editor = null;

// Vistas que no dependen del mes: en vez del selector de mes llevan un título
const TITULOS_SIN_MES = { pagos: 'Pagos', cuentas: 'Cuentas', ajustes: 'Ajustes' };

const ICONO_ANTERIOR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const ICONO_SIGUIENTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const ICONO_CERRAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const nombreMetodo = (m) => (m === 'efectivo' ? '💵 Efectivo' : '💳 Cuenta');

/** Importe en euros; en rojo si es negativo (para saldos). */
const importeHtml = (cent) => `<span class="${cent < 0 ? 'negativo' : ''}">${formatearEuros(cent)}</span>`;

/* ============================================================
 * 2. Vistas
 * ============================================================ */

function render() {
  renderCabecera();
  // En el editor, los controles usan colores neutros fijos: si eliges colores ilegibles, el editor sigue legible
  elVista.classList.toggle('editando', estado.vista === 'editor-tema');
  elCabecera.classList.toggle('editando', estado.vista === 'editor-tema');
  const pestanaActiva = estado.vista === 'editor-tema' ? 'ajustes' : estado.vista; // el editor cuelga de Ajustes
  document.querySelectorAll('.tabs [data-vista]').forEach((b) => {
    if (b.dataset.vista === pestanaActiva) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (estado.vista === 'resumen') renderResumen();
  else if (estado.vista === 'historial') renderHistorial();
  else if (estado.vista === 'pagos') renderPagos();
  else if (estado.vista === 'cuentas') renderCuentas();
  else if (estado.vista === 'editor-tema') renderEditorTema();
  else renderAjustes();
  pintarInsignia();
}

function irA(vista) {
  if (editor) { // saliendo del editor por una pestaña: volver a los colores guardados
    editor = null;
    aplicarTema(almacen.preferencia('tema'), almacen.preferencia('modo'));
    if (history.state?.editor) history.back();
  }
  estado.vista = vista;
  render();
  elVista.scrollTop = 0;
  if (vista === 'pagos') refrescarAvisos();
}

/* ---------- Cabecera (navegación entre meses) ---------- */
function renderCabecera() {
  if (estado.vista === 'editor-tema') {
    elCabecera.innerHTML = `
      <button type="button" class="btn-mes" data-accion="editor-salir" aria-label="Volver a Ajustes">${ICONO_ANTERIOR}</button>
      <h1 class="titulo">Editar tema</h1><span></span>`;
    return;
  }
  if (TITULOS_SIN_MES[estado.vista]) {
    elCabecera.innerHTML = `<span></span><h1 class="titulo">${TITULOS_SIN_MES[estado.vista]}</h1><span></span>`;
    return;
  }
  const enMesActual = estado.mes >= mesActual(); // no se puede avanzar más allá de este mes
  elCabecera.innerHTML = `
    <button type="button" class="btn-mes" data-accion="mes-ant" aria-label="Mes anterior">${ICONO_ANTERIOR}</button>
    <h1 class="titulo">${esc(nombreMes(estado.mes))}</h1>
    <button type="button" class="btn-mes" data-accion="mes-sig" aria-label="Mes siguiente" ${enMesActual ? 'disabled' : ''}>${ICONO_SIGUIENTE}</button>`;
}

/* ---------- Resumen del mes ---------- */

/** Calcula totales del mes: total, cuenta/efectivo y gasto por categoría. */
function resumenDelMes(mes) {
  const lista = almacen.gastosDelMes(mes);
  const porCategoria = new Map();
  let total = 0, cuenta = 0, efectivo = 0;
  for (const g of lista) {
    total += g.cent;
    if (g.metodo === 'efectivo') efectivo += g.cent;
    else cuenta += g.cent;
    porCategoria.set(g.cat, (porCategoria.get(g.cat) ?? 0) + g.cent);
  }
  const categorias = [...porCategoria]
    .map(([id, cent]) => ({ ...categoriaPorId(id), cent }))
    .sort((a, b) => b.cent - a.cent);
  return { lista, total, cuenta, efectivo, categorias };
}

function htmlVacio(mensajeMes) {
  const esteMes = estado.mes === mesActual();
  return `
    <div class="vacio">
      <p class="vacio-titulo">${esteMes ? 'Aún no hay gastos este mes' : `No hay gastos en ${esc(mensajeMes)}`}</p>
      ${esteMes ? '<p>Escribe uno abajo, por ejemplo <em>«3,50 en cafetería uni»</em>.</p>' : ''}
    </div>`;
}

/** Línea con el dinero disponible (solo si ya has apuntado tus saldos). Lleva a la pestaña Cuentas. */
function htmlSaldoLinea() {
  const s = almacen.saldoActual();
  if (!s) return '';
  return `
    <button type="button" class="saldo-linea" data-accion="ir-cuentas">
      <span>Disponible ahora</span><b>${importeHtml(s.cuenta + s.efectivo)}</b>
      <small>💳 ${importeHtml(s.cuenta)} · 💵 ${importeHtml(s.efectivo)}</small>
    </button>`;
}

function renderResumen() {
  const r = resumenDelMes(estado.mes);
  if (!r.lista.length) {
    elVista.innerHTML = htmlAvisoPagos() + htmlSaldoLinea() + htmlVacio(nombreMes(estado.mes));
    return;
  }
  const { entero, decimales } = partesNumero(r.total);
  const tipo = almacen.preferencia('grafica');
  const analisis = datosAnalisis(estado.mes, r.lista);

  elVista.innerHTML = `
    ${htmlAvisoPagos()}
    ${htmlSaldoLinea()}
    <section class="total" aria-label="Total gastado en el mes">
      <p class="total-cifra" aria-label="${esc(formatearEuros(r.total))}">
        <span class="total-ent">${entero}</span><span class="total-dec">,${decimales}</span><span class="total-eur">€</span>
      </p>
      <p class="total-nota">${plural(r.lista.length, 'gasto', 'gastos')} en ${esc(nombreMes(estado.mes))}</p>
      <div class="reparto">
        <div class="reparto-barra" aria-hidden="true">
          <span class="rp-cuenta" style="flex:${r.cuenta} 1 0%"></span>
          <span class="rp-efectivo" style="flex:${r.efectivo} 1 0%"></span>
        </div>
        <div class="reparto-leyenda">
          <span><i class="marca rp-cuenta"></i>Cuenta <b>${formatearEuros(r.cuenta)}</b></span>
          <span><i class="marca rp-efectivo"></i>Efectivo <b>${formatearEuros(r.efectivo)}</b></span>
        </div>
      </div>
    </section>

    <section class="grafica">
      <div class="grafica-cab">
        <h2>Por categoría</h2>
        <div class="segmentado" role="group" aria-label="Tipo de gráfica">
          <button type="button" data-accion="grafica" data-valor="circular" aria-pressed="${tipo !== 'barras'}">Circular</button>
          <button type="button" data-accion="grafica" data-valor="barras" aria-pressed="${tipo === 'barras'}">Barras</button>
        </div>
      </div>
      ${tipo === 'barras' ? htmlBarras(r.categorias, r.total) : htmlDonut(r.categorias, r.total)}
    </section>

    ${htmlLimites(r)}
    ${htmlRecortar(r, analisis)}
    ${htmlComparativa(analisis)}`;
}

/* ---------- Análisis del mes: límites, «¿Qué podría recortar?» y comparativa ---------- */

const pctTexto = (x) => `${Math.round(Math.abs(x) * 100)}\u00a0%`;

/**
 * Prepara la comparativa del mes que se está viendo con el mes anterior COMPLETO.
 * En el mes en curso la comparativa va creciendo a medida que gastas: se mira a final de mes.
 */
function datosAnalisis(mes, listaMes) {
  const previo = desplazarMes(mes, -1);
  const delPrevio = almacen.gastosDelMes(previo);
  return {
    previo,
    enCurso: mes === mesActual(),
    hayPrevio: delPrevio.length > 0,
    comparacion: comparar(listaMes, delPrevio),
    fijos: fijosPorCategoria(listaMes),
  };
}

/** Barras de progreso de los límites que hayas fijado (o una invitación a fijarlos). */
function htmlLimites(r) {
  const limites = almacen.limites();
  const conLimite = CATEGORIAS.filter((c) => limites[c.id]);
  if (!conLimite.length) {
    return `
      <div class="pagos-cab"><h2>Límites del mes</h2></div>
      <div class="estado-avisos">Ponle un tope a una categoría (por ejemplo, 60 € en Ocio) y aquí verás cuánto llevas.</div>
      <button type="button" class="fila-boton" data-accion="editar-limites">Fijar límites</button>`;
  }
  const gastado = new Map(r.categorias.map((c) => [c.id, c.cent]));
  const filas = conLimite.map((c) => {
    const g = gastado.get(c.id) ?? 0;
    const e = estadoLimite(g, limites[c.id]);
    const frase = e.excedido
      ? `Te has pasado ${formatearEuros(-e.restante)}`
      : e.cerca ? `Casi en el límite · quedan ${formatearEuros(e.restante)}` : `Quedan ${formatearEuros(e.restante)}`;
    return `
      <button type="button" class="limite" data-accion="filtrar-cat" data-cat="${c.id}">
        <span class="limite-cab">
          <span>${c.emoji} ${esc(c.nombre)}</span>
          <span class="limite-cifras ${e.excedido ? 'negativo' : ''}">${formatearEuros(g)} de ${formatearEuros(limites[c.id])}</span>
        </span>
        <span class="limite-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${e.pct}" aria-label="${esc(c.nombre)}: ${e.pct} %">
          <span style="width:${e.pct}%;background:${e.excedido ? 'var(--peligro)' : c.color}"></span>
        </span>
        <small class="${e.excedido ? 'negativo' : ''}">${frase}</small>
      </button>`;
  }).join('');
  return `
    <div class="pagos-cab"><h2>Límites del mes</h2><button type="button" class="enlace" data-accion="editar-limites">Editar</button></div>
    <div class="limites">${filas}</div>`;
}

/** Lo que más gastas y lo que más ha subido, en pocas líneas y sin sermones. */
function htmlRecortar(r, a) {
  const { filas, totalActual } = a.comparacion;
  const top = topCategorias(filas, 3);
  const subidas = mayoresSubidas(filas, 3);
  const mesPrevio = mesSolo(a.previo);

  const filaTop = (f) => {
    const c = categoriaPorId(f.cat);
    const fijo = a.fijos.get(f.cat) ?? 0;
    return `
      <li>
        <span>${c.emoji} ${esc(c.nombre)}${fijo ? `<small>incluye ${formatearEuros(fijo)} de pagos fijos</small>` : ''}</span>
        <b>${formatearEuros(f.actual)} <small>${pctTexto(f.actual / totalActual)}</small></b>
      </li>`;
  };
  const filaSubida = (f) => {
    const c = categoriaPorId(f.cat);
    const detalle = f.pct === null ? 'nuevo este mes' : `+${pctTexto(f.pct)}`;
    return `<li><span>${c.emoji} ${esc(c.nombre)}</span><b class="sube">+${formatearEuros(f.delta)} <small>${detalle}</small></b></li>`;
  };

  let subidasHtml;
  if (!a.hayPrevio) subidasHtml = `<p class="nota">Cuando tengas un mes anterior con gastos, aquí verás lo que más ha subido.</p>`;
  else if (!subidas.length) subidasHtml = `<p class="nota">Nada ha subido de forma notable respecto a ${esc(mesPrevio)}.</p>`;
  else subidasHtml = `<ul class="lista-recortar">${subidas.map(filaSubida).join('')}</ul>`;

  return `
    <div class="pagos-cab"><h2>¿Qué podría recortar?</h2></div>
    <div class="recortar">
      <p class="recortar-tit">Donde más gastas</p>
      <ul class="lista-recortar">${top.map(filaTop).join('')}</ul>
      <p class="recortar-tit">Lo que más ha subido respecto a ${esc(mesPrevio)}</p>
      ${subidasHtml}
    </div>`;
}

function htmlCambio(f) {
  if (f.delta === 0) return '<span class="cambio">igual</span>';
  const sube = f.delta > 0;
  let extra = '';
  if (f.anterior === 0) extra = 'nuevo';
  else if (f.actual === 0) extra = 'sin gasto';
  else if (f.pct !== null) extra = pctTexto(f.pct);
  return `<span class="cambio ${sube ? 'sube' : 'baja'}">${sube ? '▲' : '▼'} ${formatearEuros(Math.abs(f.delta))}<small>${extra}</small></span>`;
}

/** Categoría por categoría: cuánto más o menos que el mes anterior. */
function htmlComparativa(a) {
  if (!a.hayPrevio) return '';
  const { filas, totalActual, totalAnterior, delta, pct } = a.comparacion;
  const mesPrevio = mesSolo(a.previo);
  const total = { actual: totalActual, anterior: totalAnterior, delta, pct };
  const fila = (f, c) => `
    <div class="comp-fila">
      <span class="comp-nombre">${c.emoji} ${esc(c.nombre)}</span>
      <span class="comp-importe">${formatearEuros(f.actual)}</span>
      ${htmlCambio(f)}
    </div>`;
  return `
    <div class="pagos-cab"><h2>Frente a ${esc(mesPrevio)}</h2></div>
    <p class="nota nota-comp">Comparado con ${esc(mesPrevio)} completo.${a.enCurso ? ' El mes sigue en curso: las cifras irán subiendo.' : ''}</p>
    <div class="comparativa">
      <div class="comp-fila comp-total">
        <span class="comp-nombre">Total</span>
        <span class="comp-importe">${formatearEuros(totalActual)}</span>
        ${htmlCambio(total)}
      </div>
      ${filas.map((f) => fila(f, categoriaPorId(f.cat))).join('')}
    </div>`;
}

/** Frase para el aviso al guardar un gasto, solo si te acercas o te pasas del límite de esa categoría. */
function textoLimite(idCat, mes) {
  const limite = almacen.limites()[idCat];
  if (!limite) return undefined;
  const gastado = almacen.gastosDelMes(mes).filter((g) => g.cat === idCat).reduce((t, g) => t + g.cent, 0);
  const e = estadoLimite(gastado, limite);
  const c = categoriaPorId(idCat);
  if (e.excedido) return `${c.emoji} ${c.nombre}: te has pasado ${formatearEuros(-e.restante)} del límite`;
  if (e.cerca) return `${c.emoji} ${c.nombre}: llevas ${formatearEuros(gastado)} de ${formatearEuros(limite)}`;
  return undefined;
}
/* ---------- Historial ---------- */

function htmlFilaGasto(g) {
  const c = categoriaPorId(g.cat);
  return `
    <button type="button" class="gasto" data-accion="editar" data-id="${esc(g.id)}">
      <span class="gasto-icono" style="--c:${c.color}" aria-hidden="true">${c.emoji}</span>
      <span class="gasto-texto">
        <span class="gasto-concepto">${esc(g.concepto)}</span>
        <span class="gasto-sub">${esc(c.nombre)} · ${nombreMetodo(g.metodo)}${g.pagoId ? ' · 🔁 Fijo' : ''}</span>
      </span>
      <span class="gasto-importe">${formatearEuros(g.cent)}</span>
    </button>`;
}

function renderHistorial() {
  const delMes = almacen.gastosDelMes(estado.mes);
  const lista = delMes.filter(
    (g) => (!estado.filtroCat || g.cat === estado.filtroCat) && (!estado.filtroMetodo || g.metodo === estado.filtroMetodo),
  );
  const suma = lista.reduce((acc, g) => acc + g.cent, 0);

  const opcionesCat = CATEGORIAS.map(
    (c) => `<option value="${c.id}" ${c.id === estado.filtroCat ? 'selected' : ''}>${c.emoji} ${esc(c.nombre)}</option>`,
  ).join('');
  const metodos = [['', 'Todos'], ['cuenta', '💳 Cuenta'], ['efectivo', '💵 Efectivo']]
    .map(([v, t]) => `<button type="button" data-accion="filtro-metodo" data-valor="${v}" aria-pressed="${estado.filtroMetodo === v}">${t}</button>`)
    .join('');

  const filtros = `
    <div class="filtros">
      <select id="filtro-cat" class="select-cat" aria-label="Filtrar por categoría">
        <option value="">Todas las categorías</option>${opcionesCat}
      </select>
      <div class="segmentado" role="group" aria-label="Filtrar por método de pago">${metodos}</div>
    </div>`;

  let cuerpo;
  if (!delMes.length) {
    cuerpo = htmlVacio(nombreMes(estado.mes));
  } else if (!lista.length) {
    cuerpo = '<div class="vacio"><p class="vacio-titulo">Ningún gasto coincide con el filtro</p></div>';
  } else {
    // Subtotal por día para mostrarlo en la cabecera de cada día
    const totalDia = new Map();
    for (const g of lista) totalDia.set(g.fecha, (totalDia.get(g.fecha) ?? 0) + g.cent);

    let html = `<p class="resumen-lista"><b>${plural(lista.length, 'gasto', 'gastos')}</b> · ${formatearEuros(suma)}</p>`;
    let diaActual = null;
    for (const g of lista) {
      if (g.fecha !== diaActual) {
        diaActual = g.fecha;
        html += `<div class="dia-cab"><strong>${esc(etiquetaDia(g.fecha))}</strong><span>${formatearEuros(totalDia.get(g.fecha))}</span></div>`;
      }
      html += htmlFilaGasto(g);
    }
    cuerpo = html + '<p class="ayuda">Toca un gasto para editarlo o borrarlo.</p>';
  }
  elVista.innerHTML = filtros + cuerpo;
}

/* ---------- Cuentas (saldos, ingresos y traspasos) ---------- */

/** Fila de la lista de movimientos (ingresos y traspasos). */
function htmlFilaMovimiento(m) {
  const esIngreso = m.tipo === 'ingreso';
  const detalle = esIngreso
    ? `${nombreMetodo(m.metodo)} · ${etiquetaDia(m.fecha)}`
    : `${nombreMetodo(m.metodo)} → ${nombreMetodo(m.destino)} · ${etiquetaDia(m.fecha)}`;
  return `
    <button type="button" class="gasto" data-accion="editar-mov" data-id="${esc(m.id)}">
      <span class="gasto-icono" style="--c:${esIngreso ? 'var(--c-super)' : 'var(--c-transporte)'}" aria-hidden="true">${esIngreso ? '➕' : '🔄'}</span>
      <span class="gasto-texto">
        <span class="gasto-concepto">${esc(m.concepto)}</span>
        <span class="gasto-sub">${detalle}</span>
      </span>
      <span class="gasto-importe ${esIngreso ? 'mov-importe-mas' : ''}">${formatearEuros(m.cent)}</span>
    </button>`;
}

/** Primera vez: pregunta cuánto dinero tienes ahora. */
function htmlInicioSaldos() {
  return `
    <section class="bloque inicio-saldos">
      <h2>¿Cuánto tienes ahora?</h2>
      <p class="nota">Apunta lo que hay hoy en tu cuenta y en efectivo. A partir de ahí, cada gasto lo resta y cada ingreso lo suma. Podrás corregirlo cuando quieras.</p>
      <label class="campo">💳 En la cuenta
        <input id="saldo-cuenta" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00">
      </label>
      <label class="campo">💵 En efectivo
        <input id="saldo-efectivo" type="text" inputmode="decimal" autocomplete="off" placeholder="0,00">
      </label>
      <button type="button" class="btn btn-prim" data-accion="guardar-saldos">Empezar a llevar la cuenta</button>
      <p class="ayuda">Esto es opcional: si solo quieres registrar gastos, ignora esta pestaña.</p>
    </section>`;
}

function renderCuentas() {
  const s = almacen.saldoActual();
  if (!s) {
    elVista.innerHTML = htmlInicioSaldos();
    return;
  }
  const total = s.cuenta + s.efectivo;
  const { entero, decimales } = partesNumero(total);
  const desde = new Date(almacen.saldoDesde()).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  const movimientos = almacen.listarMovimientos().slice(0, 40);

  const fila = (metodo, titulo) => `
    <div class="cuenta-fila">
      <span class="cuenta-nombre">${titulo}</span>
      <span class="cuenta-importe">${importeHtml(s[metodo])}</span>
      <button type="button" class="enlace" data-accion="corregir-saldo" data-metodo="${metodo}" aria-label="Corregir saldo ${metodo === 'cuenta' ? 'de la cuenta' : 'en efectivo'}">Corregir</button>
    </div>`;

  elVista.innerHTML = `
    <section class="disponible">
      <p class="total-cifra ${total < 0 ? 'negativo' : ''}" aria-label="${esc(formatearEuros(total))}">
        <span class="total-ent">${entero}</span><span class="total-dec">,${decimales}</span><span class="total-eur">€</span>
      </p>
      <p class="total-nota">Disponible entre cuenta y efectivo</p>
    </section>

    <div class="cuentas">${fila('cuenta', '💳 Cuenta')}${fila('efectivo', '💵 Efectivo')}</div>

    <div class="acciones-cuentas">
      <button type="button" class="btn btn-prim" data-accion="nuevo-ingreso">Añadir dinero</button>
      <button type="button" class="btn btn-sec" data-accion="nuevo-traspaso">Pasar dinero</button>
    </div>

    <h2 class="lista-mov-cab">Ingresos y traspasos</h2>
    ${movimientos.length
      ? `<div>${movimientos.map(htmlFilaMovimiento).join('')}</div>`
      : '<p class="nota">Aquí aparecerán el dinero que añadas y lo que saques del cajero. También puedes escribir «+50 paga» o «retiro 40» en la barra de abajo.</p>'}

    <p class="ayuda">Saldos contados desde el ${esc(desde)}. Los gastos se restan solos.</p>`;
}

/* ---------- Ajustes ---------- */

function renderAjustes() {
  const palabras = Object.entries(almacen.aprendido()).sort(([a], [b]) => a.localeCompare(b, 'es'));
  const total = almacen.todosLosGastos().length;
  const temaActual = almacen.preferencia('tema');
  const modoActual = almacen.preferencia('modo');
  const esquema = esOscuro(modoActual) ? 'oscuro' : 'claro';

  const botonesModo = MODOS.map(
    (m) => `<button type="button" data-accion="modo" data-valor="${m.id}" aria-pressed="${m.id === modoActual}">${m.nombre}</button>`,
  ).join('');

  // Cada tema se enseña como una miniatura de la app con sus colores
  const tarjetasTema = listarTemas().map((t) => {
    const m = muestraDe(t, esquema);
    return `
      <button type="button" class="tema" data-accion="tema" data-valor="${t.id}" aria-pressed="${t.id === temaActual}" aria-label="Tema ${esc(t.nombre)}">
        <span class="tema-muestra" style="background:${m.fondo}">
          <span class="tema-puntos">${m.puntos.map((c) => `<i style="background:${c}"></i>`).join('')}</span>
          <span class="tema-barra" style="background:${m.dock}"><i style="background:${m.enviar}"></i></span>
        </span>
        <span class="tema-nombre">${esc(t.nombre)}</span>
      </button>`;
  }).join('');

  const htmlPalabras = palabras.length
    ? `<ul class="aprendidas">${palabras
        .map(([palabra, id]) => {
          const c = categoriaPorId(id);
          return `<li class="aprendida">
            <span><b>${esc(palabra)}</b> → ${c.emoji} ${esc(c.nombre)}</span>
            <button type="button" data-accion="olvidar" data-palabra="${esc(palabra)}" aria-label="Olvidar ${esc(palabra)}">${ICONO_CERRAR}</button>
          </li>`;
        })
        .join('')}</ul>`
    : '<p class="nota">Todavía no has enseñado ninguna palabra. Cuando la app no reconozca un concepto, te preguntará y lo recordará.</p>';

  elVista.innerHTML = `
    <section class="bloque">
      <h2>Apariencia</h2>
      <div class="segmentado" role="group" aria-label="Modo de color">${botonesModo}</div>
      <div class="temas">${tarjetasTema}</div>
      <button type="button" class="fila-boton" data-accion="editar-tema">Editar «${esc(temaPorId(temaActual).nombre)}» <small>colores y nombre</small></button>
      <button type="button" class="fila-boton" data-accion="nuevo-tema">Crear un tema nuevo <small>a partir de este</small></button>
      <p class="ayuda">«Automático» sigue el modo claro u oscuro de tu móvil.</p>
    </section>

    <section class="bloque">
      <h2>Límites por categoría</h2>
      <button type="button" class="fila-boton" data-accion="editar-limites">Límites mensuales <small>${Object.keys(almacen.limites()).length ? `${plural(Object.keys(almacen.limites()).length, 'fijado', 'fijados')}` : 'ninguno'}</small></button>
    </section>

    <section class="bloque">
      <h2>Copia de seguridad</h2>
      <p class="nota">Tus datos solo están en este móvil. Guarda una copia de vez en cuando (${plural(total, 'gasto guardado', 'gastos guardados')}).</p>
      <button type="button" class="fila-boton" data-accion="exportar-json">Guardar copia completa <small>.json</small></button>
      <button type="button" class="fila-boton" data-accion="exportar-csv">Exportar gastos a Excel <small>.csv</small></button>
      <label class="fila-boton">Importar o restaurar copia <small>.json / .csv</small>
        <input type="file" id="archivo" accept=".json,.csv,application/json,text/csv" hidden>
      </label>
      <p class="ayuda">La copia completa incluye gastos, ingresos, saldos, pagos fijos, límites, temas y palabras aprendidas. El CSV solo lleva los gastos.</p>
    </section>

    <section class="bloque">
      <h2>Palabras que he aprendido</h2>
      ${htmlPalabras}
    </section>

    ${estado.instalador ? `
    <section class="bloque">
      <h2>Instalar</h2>
      <button type="button" class="fila-boton" data-accion="instalar">Añadir a la pantalla de inicio</button>
    </section>` : ''}

    <p class="version">Versión 5 · Todo se guarda solo en este dispositivo</p>`;
}

/* ---------- Eventos de las vistas (delegación) ---------- */

elCabecera.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el || el.disabled) return;
  if (el.dataset.accion === 'editor-salir') return cerrarEditor();
  estado.mes = desplazarMes(estado.mes, el.dataset.accion === 'mes-ant' ? -1 : 1);
  render();
});

$('.tabs').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-vista]');
  if (boton) irA(boton.dataset.vista);
});

elVista.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el) return;
  const { accion, valor, cat, id, palabra, metodo, mes } = el.dataset;

  switch (accion) {
    case 'grafica':
      almacen.guardarPreferencia('grafica', valor);
      render();
      break;
    case 'filtrar-cat': // desde el Resumen: saltar al Historial filtrado por esa categoría
      estado.filtroCat = cat;
      irA('historial');
      break;
    case 'filtro-metodo':
      estado.filtroMetodo = valor;
      render();
      break;
    case 'editar':
      abrirHojaEditar(id);
      break;
    case 'ir-cuentas':
      irA('cuentas');
      break;
    case 'ir-pagos':
      irA('pagos');
      break;
    case 'editar-limites':
      abrirHojaLimites();
      break;
    case 'nuevo-pago':
      abrirHojaPago();
      break;
    case 'editar-pago':
      abrirHojaPago(id);
      break;
    case 'pago-pagado':
      marcarPagado(id, mes);
      break;
    case 'pago-aplazar':
      aplazarPago(id, mes);
      break;
    case 'pago-omitir':
      omitirPago(id, mes);
      break;
    case 'calendario-todos':
      exportarCalendario(almacen.listarPagos());
      break;
    case 'avisos-activar':
      activarAvisos();
      break;
    case 'avisos-probar':
      enviarAvisoDePrueba();
      break;
    case 'avisos-comprobar':
      comprobarAvisosAhora();
      break;
    case 'guardar-saldos':
      guardarSaldosIniciales();
      break;
    case 'corregir-saldo':
      abrirHojaSaldo(metodo);
      break;
    case 'nuevo-ingreso':
      abrirHojaIngreso();
      break;
    case 'nuevo-traspaso':
      abrirHojaTraspaso();
      break;
    case 'editar-mov':
      abrirHojaEditarMovimiento(id);
      break;
    case 'editar-tema':
      abrirEditor();
      break;
    case 'nuevo-tema':
      crearTemaDesdeActual();
      break;
    case 'editor-salir':
      cerrarEditor();
      break;
    case 'editor-esquema':
      editor.esquema = valor;
      render();
      vistaPreviaEditor();
      break;
    case 'editor-textos':
      ajustarTextos(editor.tema[editor.esquema]);
      persistirEditor();
      render();
      avisar('Textos ajustados para que se lean bien.');
      break;
    case 'editor-duplicar':
      duplicarTema();
      break;
    case 'editor-restaurar':
      restaurarTema();
      break;
    case 'editor-eliminar':
      eliminarTema();
      break;
    case 'tema':
      almacen.guardarPreferencia('tema', valor);
      aplicarTema(valor, almacen.preferencia('modo'));
      render();
      break;
    case 'modo':
      almacen.guardarPreferencia('modo', valor);
      aplicarTema(almacen.preferencia('tema'), valor);
      render();
      break;
    case 'olvidar':
      almacen.olvidarPalabra(palabra);
      render();
      break;
    case 'exportar-csv':
      exportar('csv');
      break;
    case 'exportar-json':
      exportar('json');
      break;
    case 'instalar':
      estado.instalador?.prompt();
      estado.instalador = null;
      render();
      break;
  }
});

elVista.addEventListener('change', async (e) => {
  if (editor) { cambioEnEditor(e.target); return; }
  if (e.target.id === 'filtro-cat') {
    estado.filtroCat = e.target.value;
    render();
  } else if (e.target.id === 'archivo') {
    await importarArchivo(e.target);
  }
});

/** Pestaña Cuentas, primera vez: guarda lo que el usuario tiene ahora. */
function guardarSaldosIniciales() {
  const cuenta = parseSaldo($('#saldo-cuenta').value);
  const efectivo = parseSaldo($('#saldo-efectivo').value);
  if (cuenta === null || efectivo === null) {
    avisar('Escribe un número válido. Ejemplo: 1250,50');
    return;
  }
  almacen.configurarSaldos({ cuenta, efectivo });
  avisar('Listo: desde ahora llevo la cuenta de tu dinero.');
  render();
}

/* ---------- Editor de temas ----------
 * Siempre edita el tema que está en uso. Cada cambio se guarda al momento y
 * se ve al instante en toda la app (que hace de vista previa). Un tema de
 * fábrica que modificas se guarda como tu versión; «Restaurar» la borra.
 */

/** Texto con un nombre que no exista ya entre los temas ("Mi tema", "Mi tema 2"...). */
function nombreLibre(base) {
  const usados = new Set(listarTemas().map((t) => t.nombre.toLowerCase()));
  const recorte = base.slice(0, 24);
  if (!usados.has(recorte.toLowerCase())) return recorte;
  for (let n = 2; ; n++) {
    const candidato = `${base.slice(0, 24 - String(n).length - 1)} ${n}`;
    if (!usados.has(candidato.toLowerCase())) return candidato;
  }
}

/** Pinta el tema en edición con el esquema (claro/oscuro) que se está retocando. */
function vistaPreviaEditor() {
  aplicarTema(editor.tema.id, editor.esquema, almacen.preferencia('modo'));
}

/** Botones inferiores del editor. «Restaurar» solo sale cuando el tema de fábrica ya tiene cambios tuyos. */
function htmlAccionesEditor() {
  const id = editor.tema.id;
  return `
    <button type="button" class="fila-boton" data-accion="editor-textos">Ajustar textos para que se lean bien <small>blanco o negro</small></button>
    <button type="button" class="fila-boton" data-accion="editor-duplicar">Duplicar este tema</button>
    ${estaModificado(id) ? '<button type="button" class="fila-boton" data-accion="editor-restaurar">Restaurar el original <small>borra tus cambios</small></button>' : ''}
    ${!esDeFabrica(id) ? '<button type="button" class="fila-boton fila-peligro" data-accion="editor-eliminar">Eliminar este tema</button>' : ''}
    <button type="button" class="btn btn-prim btn-ancho" data-accion="editor-salir">Hecho</button>`;
}

/** Guarda el tema en edición y lo refleja en la app. */
function persistirEditor() {
  almacen.guardarTemaPersonalizado(editor.tema);
  registrarTemasPersonalizados(almacen.listarTemasPersonalizados());
  vistaPreviaEditor();
  // Solo se repintan los botones (no los selectores de color, que podrían estar abiertos)
  const caja = $('#editor-acciones');
  const clave = estaModificado(editor.tema.id) ? 'modificado' : 'original';
  if (caja && caja.dataset.estado !== clave) {
    caja.innerHTML = htmlAccionesEditor();
    caja.dataset.estado = clave;
  }
}

function abrirEditor() {
  const tema = temaPorId(almacen.preferencia('tema'));
  editor = {
    tema: temaCompleto(tema),
    esquema: esOscuro(almacen.preferencia('modo')) ? 'oscuro' : 'claro',
    abiertos: new Set(['pantalla']),
  };
  estado.vista = 'editor-tema';
  history.pushState({ editor: true }, ''); // «atrás» en Android vuelve a Ajustes
  render();
  elVista.scrollTop = 0;
  vistaPreviaEditor();
}

function cerrarEditor(desdeAtras = false) {
  if (!editor) return;
  editor = null;
  estado.vista = 'ajustes';
  aplicarTema(almacen.preferencia('tema'), almacen.preferencia('modo'));
  render();
  elVista.scrollTop = 0;
  if (!desdeAtras && history.state?.editor) history.back();
}

/** «Crear un tema nuevo»: copia del tema actual, con otro nombre, listo para retocar. */
function crearTemaDesdeActual() {
  const base = temaPorId(almacen.preferencia('tema'));
  const nuevo = crearTemaNuevo(base, nombreLibre('Mi tema'));
  almacen.guardarTemaPersonalizado(nuevo);
  registrarTemasPersonalizados(almacen.listarTemasPersonalizados());
  almacen.guardarPreferencia('tema', nuevo.id);
  abrirEditor();
}

function duplicarTema() {
  const nuevo = crearTemaNuevo(editor.tema, nombreLibre(`${editor.tema.nombre} (copia)`));
  almacen.guardarTemaPersonalizado(nuevo);
  registrarTemasPersonalizados(almacen.listarTemasPersonalizados());
  almacen.guardarPreferencia('tema', nuevo.id);
  editor.tema = temaCompleto(nuevo);
  render();
  vistaPreviaEditor();
  avisar('Copia creada: ahora estás editando la copia.');
}

function restaurarTema() {
  const id = editor.tema.id;
  almacen.eliminarTemaPersonalizado(id);
  registrarTemasPersonalizados(almacen.listarTemasPersonalizados());
  editor.tema = temaCompleto(temaOriginal(id));
  render();
  vistaPreviaEditor();
  avisar('Tema original restaurado.');
}

function eliminarTema() {
  const borrado = almacen.eliminarTemaPersonalizado(editor.tema.id);
  registrarTemasPersonalizados(almacen.listarTemasPersonalizados());
  almacen.guardarPreferencia('tema', 'tinta');
  cerrarEditor();
  if (!borrado) return;
  avisar(`Tema «${borrado.nombre}» eliminado.`, {
    texto: 'Deshacer',
    fn: () => {
      almacen.guardarTemaPersonalizado(borrado);
      registrarTemasPersonalizados(almacen.listarTemasPersonalizados());
      almacen.guardarPreferencia('tema', borrado.id);
      aplicarTema(borrado.id, almacen.preferencia('modo'));
      render();
    },
  });
}

/** Variables CSS del tema en edición, como texto para un atributo style. */
const estiloVistaPrevia = () =>
  Object.entries(variablesDe(editor.tema, editor.esquema)).map(([nombre, valor]) => `${nombre}:${valor}`).join(';');

/**
 * Miniatura de la app con los colores del tema en edición. Define SUS PROPIAS variables CSS
 * en línea, así se ve el tema aunque el resto del editor use colores neutros.
 */
function htmlVistaPrevia() {
  const franjas = CATEGORIAS.map((c) => `<span style="background:${c.color}"></span>`).join('');
  return `
    <div id="vista-previa" class="previa" aria-hidden="true" style="${estiloVistaPrevia()}">
      <div class="previa-cab"><span>Así se ve</span><b>641,21 €</b></div>
      <div class="previa-tarjeta">
        <div class="gasto">
          <span class="gasto-icono" style="--c:var(--c-comida)">🍔</span>
          <span class="gasto-texto"><span class="gasto-concepto">Cafetería uni</span><span class="gasto-sub">Comida fuera · 💳 Cuenta</span></span>
          <span class="gasto-importe">3,00 €</span>
        </div>
      </div>
      <div class="previa-cats">${franjas}</div>
      <div class="previa-dock"><span class="previa-campo">Ej: 3,50 en cafetería uni</span><span class="previa-enviar">↑</span></div>
    </div>`;
}

function actualizarVistaPrevia() {
  $('#vista-previa')?.setAttribute('style', estiloVistaPrevia());
}

/** Mensajes de legibilidad del esquema en edición (o un «todo bien»). */
function htmlAvisosLegibilidad() {
  const problemas = avisosLegibilidad(editor.tema[editor.esquema]);
  if (!problemas.length) return '<p class="legibilidad-ok">✓ Todos los textos se leen bien</p>';
  return `<ul class="legibilidad-aviso">${problemas.map((m) => `<li>⚠ ${esc(m)}</li>`).join('')}</ul>`;
}

function actualizarAvisosLegibilidad() {
  const caja = $('#avisos-legibilidad');
  if (caja) caja.innerHTML = htmlAvisosLegibilidad();
}

function renderEditorTema() {
  const t = editor.tema;
  const esquema = t[editor.esquema];

  // Una fila = nombre del color + selector + código hexadecimal (para pegar un color exacto)
  const fila = (etiqueta, ayuda, valor, atributo) => `
    <div class="color-fila">
      <span class="color-etiqueta">${esc(etiqueta)}${ayuda ? `<small>${esc(ayuda)}</small>` : ''}</span>
      <input type="color" ${atributo} value="${valor}" aria-label="Color: ${esc(etiqueta)}">
      <input type="text" class="hex" ${atributo} value="${valor}" maxlength="7" autocomplete="off"
             autocapitalize="off" spellcheck="false" aria-label="Código del color: ${esc(etiqueta)}">
    </div>`;

  const grupo = (id, titulo, contenido) =>
    `<details class="grupo-color" data-grupo="${id}" ${editor.abiertos.has(id) ? 'open' : ''}><summary>${esc(titulo)}</summary>${contenido}</details>`;

  const grupos = GRUPOS_COLOR.map((g) =>
    grupo(g.id, g.titulo, g.claves.map(([clave, etiqueta, ayuda]) => fila(etiqueta, ayuda, esquema[clave], `data-color="${clave}"`)).join('')),
  ).join('');

  const categorias = grupo(
    'categorias',
    'Colores de las categorías',
    `<p class="nota">Estos colores valen para el modo claro y el oscuro.</p>` +
      CATEGORIAS.map((c, i) => fila(`${c.emoji} ${c.nombre}`, '', t.categorias[i], `data-catidx="${i}"`)).join(''),
  );

  elVista.innerHTML = `
    <section class="editor">
      ${htmlVistaPrevia()}
      <label class="campo">Nombre del tema
        <input id="tema-nombre" type="text" maxlength="24" autocomplete="off" value="${esc(t.nombre)}">
      </label>

      <div class="campo"><span>Estás retocando los colores del modo…</span>
        <div class="segmentado" role="group" aria-label="Modo que estás editando">
          <button type="button" data-accion="editor-esquema" data-valor="claro" aria-pressed="${editor.esquema === 'claro'}">☀️ Claro</button>
          <button type="button" data-accion="editor-esquema" data-valor="oscuro" aria-pressed="${editor.esquema === 'oscuro'}">🌙 Oscuro</button>
        </div>
      </div>
      <p class="ayuda ayuda-izq">Los cambios se ven al momento en toda la app. Toca un color para cambiarlo, o escribe su código (por ejemplo #b97d7b).</p>

      <div id="avisos-legibilidad" class="legibilidad" aria-live="polite">${htmlAvisosLegibilidad()}</div>

      ${grupos}
      ${categorias}

      <div id="editor-acciones" class="editor-acciones" data-estado="${estaModificado(t.id) ? 'modificado' : 'original'}">${htmlAccionesEditor()}</div>
    </section>`;
}

/** Cualquier cambio de un color (selector o código) o del nombre. */
elVista.addEventListener('input', (e) => {
  if (!editor) return;
  const el = e.target;

  if (el.id === 'tema-nombre') {
    editor.tema.nombre = el.value.slice(0, 24);
    persistirEditor();
    return;
  }
  if (!('color' in el.dataset) && !('catidx' in el.dataset)) return;

  const fila = el.closest('.color-fila');
  const campoHex = fila.querySelector('.hex');
  const valor = normalizarHex(el.value);
  if (!valor) { // mientras escribes "#b9" todavía no es un color: se espera
    campoHex.classList.add('invalido');
    return;
  }
  campoHex.classList.remove('invalido');
  fila.querySelector('input[type="color"]').value = valor;
  if (el.type === 'color') campoHex.value = valor;

  if ('catidx' in el.dataset) editor.tema.categorias[Number(el.dataset.catidx)] = valor;
  else editor.tema[editor.esquema][el.dataset.color] = valor;
  persistirEditor();
  actualizarAvisosLegibilidad();
  actualizarVistaPrevia();
});

/** Al terminar de escribir: nombre vacío → «Mi tema»; código a medias → vuelve al último color válido. */
function cambioEnEditor(el) {
  if (el.id === 'tema-nombre') {
    if (!el.value.trim()) {
      editor.tema.nombre = nombreLibre('Mi tema');
      el.value = editor.tema.nombre;
      persistirEditor();
    }
  } else if (el.classList.contains('hex')) {
    el.value = 'catidx' in el.dataset
      ? editor.tema.categorias[Number(el.dataset.catidx)]
      : editor.tema[editor.esquema][el.dataset.color];
    el.classList.remove('invalido');
  }
}

// Recordar qué grupos de colores tienes abiertos (el evento «toggle» no sube, por eso se captura)
elVista.addEventListener('toggle', (e) => {
  const grupoId = e.target.dataset?.grupo;
  if (!editor || !grupoId) return;
  if (e.target.open) editor.abiertos.add(grupoId);
  else editor.abiertos.delete(grupoId);
}, true);

/* ---------- Pagos fijos y recordatorios ----------
 * Un «pago» es una plantilla (ver js/pagos.js). Cada vez que toca, se convierte en una
 * ocurrencia que puede:
 *   - apuntarse SOLA como gasto (pagos «se apunta solo», p. ej. el gimnasio domiciliado), o
 *   - quedar PENDIENTE hasta que confirmes que lo has pagado («lo pago yo», p. ej. un Bizum).
 * Ambas cosas se combinan con un aviso (recordatorio) y con cambios solo para un mes concreto.
 */

/** Copia de los pagos para el service worker (él no puede leer localStorage). */
function sincronizarSW() {
  return guardarKV('pagos', JSON.parse(JSON.stringify(almacen.listarPagos()))).catch(() => {});
}

/**
 * Apunta SOLOS los pagos «se apunta solo» que ya tocan y cierra los que marcaste como «omitir».
 * Devuelve la lista de gastos creados [{ concepto, cent }].
 *
 * Saldos: el gasto se crea con la marca de tiempo del día que tocaba (a mediodía). Si apuntaste
 * tus saldos DESPUÉS de esa fecha, ese pago ya está reflejado en lo que tienes y no se resta
 * dos veces; si fue después, sí se resta (ver almacen.js → saldoActual).
 */
function aplicarPagosAutomaticos() {
  const { automaticas, omitidas } = calcularEstado(almacen.listarPagos(), fechaISO());
  const creados = [];
  for (const o of omitidas) almacen.marcarOcurrencia(o.pago.id, o.mes, { omitido: true });
  for (const o of automaticas) {
    const mediodia = new Date(`${o.fecha}T12:00:00`).getTime();
    const gasto = almacen.agregarGasto({
      cent: o.cent, concepto: o.pago.concepto, cat: o.pago.cat, metodo: o.pago.metodo,
      fecha: o.fecha, pagoId: o.pago.id, creado: Math.min(mediodia, Date.now()),
    });
    almacen.marcarOcurrencia(o.pago.id, o.mes, { gastoId: gasto.id });
    creados.push({ concepto: o.pago.concepto, cent: o.cent });
  }
  if (creados.length || omitidas.length) sincronizarSW();
  return creados;
}

function textoApuntados(creados) {
  if (creados.length === 1) return `Pago fijo apuntado: ${creados[0].concepto} · ${formatearEuros(creados[0].cent)}`;
  return `${creados.length} pagos fijos apuntados · ${formatearEuros(creados.reduce((t, c) => t + c.cent, 0))}`;
}

const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** «Hoy» / «Venció el 5 oct» / «Mañana · 5 oct» / «En 3 días · 8 oct» */
function etiquetaOcurrencia(o) {
  if (o.dias === 0) return 'Hoy';
  if (o.dias < 0) return `Venció el ${fechaCorta(o.fecha)}`;
  return `${mayuscula(cuando(o.dias))} · ${fechaCorta(o.fecha)}`;
}

const textoModo = (p) => (p.modo === 'auto' ? '🔁 Se apunta solo' : '🙋 Lo pago yo');

/** Contador rojo en la pestaña Pagos (y en el icono de la app, si el móvil lo permite). */
function pintarInsignia() {
  const n = calcularEstado(almacen.listarPagos(), fechaISO()).pendientes.length;
  const insignia = $('#insignia-pagos'); // puede faltar si el navegador aún tiene un index.html antiguo
  if (insignia) {
    insignia.hidden = n === 0;
    insignia.textContent = n > 9 ? '9+' : String(n);
  }
  try {
    if (n) navigator.setAppBadge?.(n)?.catch(() => {});
    else navigator.clearAppBadge?.()?.catch(() => {});
  } catch { /* sin soporte */ }
}

/** Aviso en el Resumen cuando hay pagos que pagar. */
function htmlAvisoPagos() {
  const { pendientes } = calcularEstado(almacen.listarPagos(), fechaISO());
  if (!pendientes.length) return '';
  const primero = pendientes[0];
  const resto = pendientes.length > 1 ? ` y ${pendientes.length - 1} más` : '';
  return `
    <button type="button" class="aviso-pagos" data-accion="ir-pagos">
      <span aria-hidden="true">🔔</span>
      <span><b>${plural(pendientes.length, 'pago pendiente', 'pagos pendientes')}</b>
      <small>${esc(primero.pago.concepto)} · ${esc(etiquetaOcurrencia(primero).toLowerCase())}${resto}</small></span>
    </button>`;
}

/* ---------- Pestaña Pagos ---------- */

function htmlPendiente(o) {
  const c = categoriaPorId(o.pago.cat);
  const datos = `data-id="${esc(o.pago.id)}" data-mes="${o.mes}"`;
  return `
    <div class="pendiente">
      <div class="pendiente-cab">
        <span class="gasto-icono" style="--c:${c.color}" aria-hidden="true">${c.emoji}</span>
        <span class="gasto-texto">
          <span class="gasto-concepto">${esc(o.pago.concepto)}</span>
          <span class="gasto-sub ${o.dias < 0 ? 'tarde' : ''}">${esc(etiquetaOcurrencia(o))} · ${nombreMetodo(o.pago.metodo)}</span>
        </span>
        <span class="gasto-importe">${formatearEuros(o.cent)}</span>
      </div>
      <div class="pendiente-acciones">
        <button type="button" class="btn-peq principal" data-accion="pago-pagado" ${datos}>Ya lo pagué</button>
        <button type="button" class="btn-peq" data-accion="pago-aplazar" ${datos}>Más tarde</button>
        <button type="button" class="btn-peq" data-accion="pago-omitir" ${datos}>Omitir este mes</button>
      </div>
    </div>`;
}

function htmlFilaProxima(o) {
  const c = categoriaPorId(o.pago.cat);
  const campana = o.pago.aviso != null && o.dias <= o.pago.aviso ? '🔔 ' : '';
  return `
    <button type="button" class="gasto" data-accion="editar-pago" data-id="${esc(o.pago.id)}">
      <span class="gasto-icono" style="--c:${c.color}" aria-hidden="true">${c.emoji}</span>
      <span class="gasto-texto">
        <span class="gasto-concepto">${esc(o.pago.concepto)}</span>
        <span class="gasto-sub">${campana}${esc(etiquetaOcurrencia(o))} · ${textoModo(o.pago)}</span>
      </span>
      <span class="gasto-importe">${formatearEuros(o.cent)}${o.cent !== o.pago.cent ? ' ✎' : ''}</span>
    </button>`;
}

function htmlFilaPago(p) {
  const c = categoriaPorId(p.cat);
  const aviso = p.aviso != null ? ` · 🔔 ${ETIQUETAS_AVISO[p.aviso].toLowerCase()}` : '';
  return `
    <button type="button" class="gasto ${p.pausado ? 'pago-pausado' : ''}" data-accion="editar-pago" data-id="${esc(p.id)}">
      <span class="gasto-icono" style="--c:${c.color}" aria-hidden="true">${c.emoji}</span>
      <span class="gasto-texto">
        <span class="gasto-concepto">${esc(p.concepto)}</span>
        <span class="gasto-sub">${p.pausado ? '⏸ En pausa · ' : ''}${esc(describirFrecuencia(p))} · ${textoModo(p)}${aviso}</span>
      </span>
      <span class="gasto-importe">${formatearEuros(p.cent)}</span>
    </button>`;
}

function htmlPagosVacio() {
  return `
    <div class="vacio-pagos">
      <h2>Pagos que se repiten o que no debes olvidar</h2>
      <ul>
        <li><b>Se apunta solo</b>: el gimnasio u otro pago domiciliado. Cada mes aparece en tus gastos sin que hagas nada.</li>
        <li><b>Lo pago yo</b>: por ejemplo un Bizum a una amiga. La app te avisa y, cuando lo hayas pagado, lo confirmas con un toque.</li>
        <li>Puedes cambiar el importe de un mes concreto (un extra) o saltártelo.</li>
        <li>Los dos tipos pueden llevar aviso: el mismo día o con días de antelación.</li>
      </ul>
      <button type="button" class="btn btn-prim btn-ancho" data-accion="nuevo-pago">Crear mi primer pago</button>
    </div>`;
}

/** Estado de los avisos del móvil + botones para activarlos o probarlos. */
function htmlAvisosMovil() {
  const a = estado.avisos;
  let texto;
  let botones = '';
  if (!a) {
    texto = '<b>Avisos del móvil</b><small>Comprobando…</small>';
  } else if (!a.soportado) {
    texto = '<b>Avisos del móvil: no disponibles</b><small>Este navegador no permite notificaciones de la app. Usa el calendario para recibir alarmas.</small>';
  } else if (a.permiso === 'denied') {
    texto = '<b>Avisos del móvil: bloqueados</b><small>Permite las notificaciones de esta app en los ajustes de Android (Aplicaciones → Chrome o esta app → Notificaciones).</small>';
  } else if (a.permiso === 'default') {
    texto = '<b>Avisos del móvil: sin activar</b><small>Activa los avisos para que la app te recuerde los pagos aunque esté cerrada.</small>';
    botones = '<button type="button" class="fila-boton" data-accion="avisos-activar">Activar avisos del móvil</button>';
  } else {
    texto = `<b>Avisos del móvil: activados</b><small>${a.periodico
      ? 'La app comprueba los pagos en segundo plano. Android decide cuándo: puede tardar horas, así que para una alarma exacta usa el calendario.'
      : 'Este móvil no permite comprobar en segundo plano: verás los pagos pendientes al abrir la app. Para alarmas exactas usa el calendario.'}</small>`;
    botones = `
      <button type="button" class="fila-boton" data-accion="avisos-probar">Enviar un aviso de prueba</button>
      <button type="button" class="fila-boton" data-accion="avisos-comprobar">Comprobar pagos ahora</button>`;
  }
  return `<div class="estado-avisos">${texto}</div>${botones}`;
}

function renderPagos() {
  const hoy = fechaISO();
  const pagos = almacen.listarPagos();
  if (!pagos.length) {
    elVista.innerHTML = htmlPagosVacio();
    return;
  }
  const { pendientes, proximas } = calcularEstado(pagos, hoy);
  const ordenados = [...pagos].sort((a, b) => a.concepto.localeCompare(b.concepto, 'es'));

  elVista.innerHTML = `
    ${pendientes.length ? `<div class="pagos-cab"><h2>Hay que pagar</h2></div>${pendientes.map(htmlPendiente).join('')}` : ''}
    <button type="button" class="btn btn-prim btn-ancho" data-accion="nuevo-pago">Nuevo pago</button>

    ${proximas.length ? `<div class="pagos-cab"><h2>Próximos 45 días</h2></div><div>${proximas.map(htmlFilaProxima).join('')}</div>` : ''}

    <div class="pagos-cab"><h2>Mis pagos</h2></div>
    <div>${ordenados.map(htmlFilaPago).join('')}</div>

    <div class="pagos-cab"><h2>Recordatorios</h2></div>
    ${htmlAvisosMovil()}
    <button type="button" class="fila-boton" data-accion="calendario-todos">Añadir todos al calendario <small>alarma fiable</small></button>
    <p class="ayuda">Toca un pago para cambiar su importe, saltarte un mes, pausarlo o borrarlo.</p>`;
}

/* ---------- Acciones sobre un pago pendiente ---------- */

/** «Ya lo pagué»: apunta el gasto hoy y cierra esa ocurrencia. */
function marcarPagado(idPago, mes) {
  const pago = almacen.obtenerPago(idPago);
  const o = pago && ocurrencias(pago, fechaISO(), 45).find((x) => x.mes === mes);
  if (!o) return;
  const gasto = almacen.agregarGasto({ cent: o.cent, concepto: pago.concepto, cat: pago.cat, metodo: pago.metodo, fecha: fechaISO(), pagoId: pago.id });
  almacen.marcarOcurrencia(pago.id, mes, { gastoId: gasto.id });
  sincronizarSW();
  render();
  avisar(`Apuntado: ${pago.concepto} · ${formatearEuros(o.cent)}`, {
    texto: 'Deshacer',
    fn: () => {
      almacen.eliminarGasto(gasto.id);
      almacen.marcarOcurrencia(pago.id, mes, null);
      sincronizarSW();
      render();
    },
  }, [detalleSaldo(pago.metodo), textoLimite(pago.cat, mesDe(fechaISO()))]);
}

/** «Más tarde»: lo vuelve a enseñar mañana. */
function aplazarPago(idPago, mes) {
  almacen.aplazarOcurrencia(idPago, mes, sumarDias(fechaISO(), 1));
  sincronizarSW();
  render();
  avisar('Te lo recordaré mañana.');
}

/** «Omitir este mes»: no se apunta ni se vuelve a avisar de esta vez (los próximos meses siguen). */
function omitirPago(idPago, mes) {
  almacen.marcarOcurrencia(idPago, mes, { omitido: true });
  sincronizarSW();
  render();
  avisar('Omitido este mes.', {
    texto: 'Deshacer',
    fn: () => {
      almacen.marcarOcurrencia(idPago, mes, null);
      sincronizarSW();
      render();
    },
  });
}

/* ---------- Avisos del móvil y calendario ---------- */

async function leerEstadoAvisos() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return { soportado: false };
  let periodico = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    periodico = Boolean(reg.periodicSync) && (await reg.periodicSync.getTags()).includes('revisar-pagos');
  } catch { /* sin soporte de segundo plano */ }
  return { soportado: true, permiso: Notification.permission, periodico };
}

async function refrescarAvisos() {
  estado.avisos = await leerEstadoAvisos();
  if (estado.vista === 'pagos') render();
}

/** Pide a Chrome que despierte el service worker cada ~12 h (solo funciona con la app instalada). */
async function registrarSegundoPlano() {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.periodicSync) return false;
    await reg.periodicSync.register('revisar-pagos', { minInterval: 12 * 60 * 60 * 1000 });
    return true;
  } catch {
    return false;
  }
}

async function activarAvisos() {
  const permiso = await Notification.requestPermission();
  if (permiso === 'granted') {
    await sincronizarSW();
    await registrarSegundoPlano();
    avisar('Avisos activados.');
  } else {
    avisar('No se han activado los avisos.');
  }
  await refrescarAvisos();
}

async function enviarAvisoDePrueba() {
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Aviso de prueba', {
    body: 'Así te llegarán los recordatorios de pagos.',
    icon: './icons/icon-192.png',
    tag: 'prueba',
    data: { vista: 'pagos' },
  });
  avisar('Aviso de prueba enviado: mira la barra de notificaciones.');
}

/** Pide al service worker que revise los pagos ahora mismo (responde con el mensaje 'revisado'). */
async function comprobarAvisosAhora() {
  const reg = await navigator.serviceWorker.ready;
  await sincronizarSW();
  reg.active?.postMessage({ tipo: 'revisar' });
}

/** Descarga un .ics: el calendario de Android lo importa y se encarga de las alarmas. */
function exportarCalendario(pagos) {
  const validos = pagos.filter(Boolean);
  if (!validos.length) {
    avisar('No hay pagos que añadir al calendario.');
    return;
  }
  descargarArchivo('pagos.ics', generarICS(validos, fechaISO()), 'text/calendar;charset=utf-8');
  avisar('Archivo de calendario descargado: ábrelo para añadirlo a tu calendario.');
}

/* ---------- Exportar / importar ---------- */

function exportar(formato) {
  if (formato === 'csv') {
    if (!almacen.todosLosGastos().length) {
      avisar('Todavía no hay gastos que exportar.');
      return;
    }
    descargarArchivo(`gastos-${fechaISO()}.csv`, generarCSV(almacen.todosLosGastos()), 'text/csv;charset=utf-8');
    avisar('Archivo CSV descargado.');
  } else {
    const hayAlgo = almacen.todosLosGastos().length || almacen.listarMovimientos().length
      || almacen.haySaldos() || almacen.listarTemasPersonalizados().length || almacen.listarPagos().length
      || Object.keys(almacen.limites()).length;
    if (!hayAlgo) {
      avisar('Todavía no hay nada que guardar.');
      return;
    }
    descargarArchivo(`copia-gastos-${fechaISO()}.json`, almacen.copiaCompletaJSON(), 'application/json');
    avisar('Copia de seguridad descargada.');
  }
}

async function importarArchivo(input) {
  const archivo = input.files[0];
  if (!archivo) return;
  try {
    const texto = await archivo.text();
    const paquete = texto.trimStart().startsWith('{') ? almacen.leerCopiaJSON(texto) : parsearCSV(texto);
    const r = almacen.fusionar(paquete);
    const partes = [plural(r.agregados, 'gasto importado', 'gastos importados')];
    if (r.movimientos) partes.push(plural(r.movimientos, 'movimiento', 'movimientos'));
    if (r.saldosRestaurados) partes.push('saldos restaurados');
    if (r.temas) partes.push(plural(r.temas, 'tema de color', 'temas de color'));
    if (r.pagos) partes.push(plural(r.pagos, 'pago fijo', 'pagos fijos'));
    if (r.limites) partes.push(plural(r.limites, 'límite', 'límites'));
    sincronizarSW();
    registrarTemasPersonalizados(almacen.listarTemasPersonalizados());
    aplicarTema(almacen.preferencia('tema'), almacen.preferencia('modo'));
    if (r.repetidos) partes.push(`${r.repetidos} ya existían`);
    if (r.invalidos) partes.push(`${r.invalidos} ignorados por datos no válidos`);
    avisar(partes.join(' · '));
  } catch (error) {
    avisar(`No se pudo importar: ${error.message}`);
  }
  input.value = '';
  render();
}

/* ============================================================
 * 3. Hoja inferior
 *
 * Una sola hoja sirve para cuatro cosas, según `borrador.tipo`:
 *   'gasto'    confirmar o editar un gasto
 *   'ingreso'  añadir dinero (paga, beca, Bizum...) o editarlo
 *   'traspaso' pasar dinero entre cuenta y efectivo (cajero...)
 *   'saldo'    corregir cuánto tienes en la cuenta o en efectivo
 *
 * `borrador` guarda lo que se está editando. Los campos de texto actualizan
 * el borrador al escribir, así podemos repintar la hoja (por ejemplo al
 * elegir categoría) sin perder lo escrito.
 * ============================================================ */

let borrador = null;
let hojaAbierta = false;

/* ---------- Abrir la hoja ---------- */

/** Nuevo gasto a partir de una frase interpretada. `catAuto` puede ser null (no reconocida). */
function abrirHojaNueva(res, catAuto) {
  borrador = {
    tipo: 'gasto',
    id: null,
    importe: aTextoEditable(res.importeCent),
    concepto: res.concepto,
    cat: catAuto,
    catInicial: catAuto,
    metodo: almacen.preferencia('metodo'),
    fecha: fechaISO(),
    recordar: true,
    verCats: false,
  };
  abrirHoja();
}

function abrirHojaEditar(id) {
  const g = almacen.obtenerGasto(id);
  if (!g) return;
  borrador = {
    tipo: 'gasto',
    id: g.id,
    importe: aTextoEditable(g.cent),
    concepto: g.concepto,
    cat: g.cat,
    catInicial: g.cat,
    metodo: g.metodo,
    fecha: g.fecha,
    recordar: true,
    verCats: false,
  };
  abrirHoja();
}

/** Añadir dinero. `res` viene de una frase como «+50 paga»; sin `res`, la hoja sale vacía. */
function abrirHojaIngreso(res = null) {
  borrador = {
    tipo: 'ingreso',
    id: null,
    importe: res ? aTextoEditable(res.importeCent) : '',
    concepto: res && res.concepto !== 'Sin concepto' ? res.concepto : '',
    metodo: almacen.preferencia('metodo'),
    fecha: fechaISO(),
  };
  abrirHoja();
}

/** Pasar dinero entre cuenta y efectivo. Por defecto: cuenta → efectivo (sacar del cajero). */
function abrirHojaTraspaso(res = null) {
  borrador = {
    tipo: 'traspaso',
    id: null,
    importe: res ? aTextoEditable(res.importeCent) : '',
    metodo: 'cuenta', // origen
    fecha: fechaISO(),
  };
  abrirHoja();
}

function abrirHojaEditarMovimiento(id) {
  const m = almacen.obtenerMovimiento(id);
  if (!m) return;
  borrador = {
    tipo: m.tipo,
    id: m.id,
    importe: aTextoEditable(m.cent),
    concepto: m.concepto,
    metodo: m.metodo,
    fecha: m.fecha,
  };
  abrirHoja();
}

function abrirHojaSaldo(metodo) {
  const s = almacen.saldoActual();
  if (!s) return;
  borrador = { tipo: 'saldo', metodo, importe: aTextoEditable(s[metodo]) };
  abrirHoja();
}

/** Fijar o cambiar los límites mensuales de todas las categorías. */
function abrirHojaLimites() {
  const limites = almacen.limites();
  borrador = {
    tipo: 'limites',
    valores: Object.fromEntries(CATEGORIAS.map((c) => [c.id, limites[c.id] ? aTextoEditable(limites[c.id]) : ''])),
  };
  abrirHoja();
}

/** Crear un pago (sin id) o editar uno existente. */
function abrirHojaPago(id = null) {
  const hoy = fechaISO();
  const p = id ? almacen.obtenerPago(id) : null;
  if (id && !p) return;
  borrador = {
    tipo: 'pago',
    id: p?.id ?? null,
    importe: p ? aTextoEditable(p.cent) : '',
    concepto: p?.concepto ?? '',
    cat: p?.cat ?? null,       // null = automática (según el concepto)
    catInicial: p?.cat ?? null,
    verCats: false,
    metodo: p?.metodo ?? almacen.preferencia('metodo'),
    frecuencia: p?.frecuencia ?? 'mensual',
    fecha: p?.fecha ?? sumarDias(hoy, 1),
    dia: String(p?.dia ?? ''),
    modo: p?.modo ?? 'auto',
    aviso: p ? (p.aviso == null ? '' : String(p.aviso)) : '',
    avisoTocado: Boolean(p),   // si no lo has tocado, cambiar «Se apunta solo / Lo pago yo» ajusta el aviso
    pausado: p?.pausado ?? false,
    // Próximos pagos editables: mes → { texto, omitir, fecha, original, tocado }
    exc: {},
  };
  if (p) {
    for (const o of proximasEditables(p, hoy, 6)) {
      const previa = p.excepciones?.[o.mes] ?? null;
      borrador.exc[o.mes] = { texto: aTextoEditable(o.cent), omitir: o.omitida, fecha: o.fecha, original: previa, tocado: false };
    }
  }
  abrirHoja();
}

function abrirHoja() {
  hojaAbierta = true;
  elAviso.classList.remove('visible'); // que el aviso anterior no tape la hoja
  elHoja.hidden = false;
  renderHoja(true);
  // Entrada en el historial del navegador: así el botón "atrás" de Android cierra la hoja
  history.pushState({ hoja: true }, '');
  // Si el importe está vacío, se escribe ahí (abre el teclado numérico); si no, el foco va a
  // la propia hoja (sin teclado) y Enter confirma (ver el listener de teclado más abajo)
  const importe = elHoja.querySelector('#h-importe');
  if (importe && !borrador.importe) importe.focus();
  else elHoja.querySelector('.hoja')?.focus({ preventScroll: true });
}

function cerrarHoja(desdeAtras = false) {
  if (!hojaAbierta) return;
  hojaAbierta = false;
  borrador = null;
  elHoja.hidden = true;
  elHoja.innerHTML = '';
  if (!desdeAtras && history.state?.hoja) history.back();
}
window.addEventListener('popstate', () => {
  if (hojaAbierta) cerrarHoja(true);
  else if (editor) cerrarEditor(true); // el botón «atrás» de Android cierra el editor de temas
});

/* ---------- Piezas comunes de la hoja ---------- */

const htmlImporte = (b, permitirSigno = false) => `
  <div class="campo-importe">
    <input id="h-importe" type="text" inputmode="decimal" autocomplete="off" aria-label="Importe en euros"
           placeholder="0,00" value="${esc(b.importe)}">
    <span class="campo-importe-eur" aria-hidden="true">€</span>
    ${permitirSigno ? '<button type="button" class="btn-signo" data-hoja="signo" aria-label="Cambiar entre positivo y negativo">±</button>' : ''}
  </div>`;

const htmlFecha = (b) => `
  <label class="campo">Fecha
    <input id="h-fecha" type="date" value="${esc(b.fecha)}" max="${fechaISO()}">
  </label>`;

/** Control Cuenta/Efectivo; `etiquetas` = [texto para 'cuenta', texto para 'efectivo']. */
const htmlSelectorMetodo = (b, etiquetas) => `
  <div class="segmentado" role="radiogroup">
    <button type="button" role="radio" data-hoja="metodo" data-valor="cuenta" aria-checked="${b.metodo === 'cuenta'}">${etiquetas[0]}</button>
    <button type="button" role="radio" data-hoja="metodo" data-valor="efectivo" aria-checked="${b.metodo === 'efectivo'}">${etiquetas[1]}</button>
  </div>`;

/** Botones inferiores. Al editar sale "Eliminar"; al crear, "Cancelar". */
function htmlAcciones(b, { eliminable = true, deshabilitado = false } = {}) {
  const izquierda = b.id && eliminable
    ? '<button type="button" class="btn btn-peligro" data-hoja="eliminar">Eliminar</button>'
    : '<button type="button" class="btn btn-sec" data-hoja="cancelar">Cancelar</button>';
  return `<div class="acciones">${izquierda}<button type="button" class="btn btn-prim" data-hoja="guardar" ${deshabilitado ? 'disabled' : ''}>Guardar</button></div>`;
}

/* ---------- Contenido de cada tipo de hoja ---------- */

/**
 * Categoría en la hoja: botón con la elegida, o la cuadrícula para escoger.
 * `automatica`: si no hay categoría se muestra «Automática» (se deduce del concepto al guardar).
 */
function htmlBloqueCategoria(b, { automatica = false } = {}) {
  const cat = b.cat ? categoriaPorId(b.cat) : null;
  if (!cat && automatica && !b.verCats) {
    return `
      <button type="button" class="chip-cat" style="--c:var(--c-otros)" data-hoja="ver-cats">
        <span>✨ Automática</span><small>Elegir otra</small>
      </button>
      <small class="nota-hoja-chica">Se elige sola según el concepto (gimnasio → Deporte).</small>`;
  }
  if (!cat || b.verCats) {
    return `
      ${!cat && !automatica ? `<p class="aviso-cat">No sé en qué categoría va «${esc(b.concepto)}». Elige una y la recordaré.</p>` : ''}
      <div class="grid-cats">
        ${CATEGORIAS.map((c) => `
          <button type="button" class="opcion-cat ${c.id === b.cat ? 'activa' : ''}" style="--c:${c.color}" data-hoja="cat" data-cat="${c.id}">
            <span aria-hidden="true">${c.emoji}</span>${esc(c.nombre)}
          </button>`).join('')}
      </div>`;
  }
  return `
    <button type="button" class="chip-cat" style="--c:${cat.color}" data-hoja="ver-cats">
      <span>${cat.emoji} ${esc(cat.nombre)}</span><small>Cambiar</small>
    </button>`;
}

function cuerpoHojaGasto(b) {
  const cat = b.cat ? categoriaPorId(b.cat) : null;
  const clave = palabraAprendible(b.concepto);
  // Solo ofrecemos "recordar" si la categoría es distinta de la que se propuso al principio
  const mostrarRecordar = Boolean(cat) && b.cat !== b.catInicial && clave !== null;

  return {
    titulo: b.id ? 'Editar gasto' : 'Confirmar gasto',
    cuerpo: `
      ${htmlImporte(b)}
      <label class="campo">Concepto
        <input id="h-concepto" type="text" autocomplete="off" value="${esc(b.concepto)}">
      </label>
      <div class="campo"><span>Categoría</span>${htmlBloqueCategoria(b)}</div>
      <div class="campo"><span>Método de pago</span>${htmlSelectorMetodo(b, ['💳 Cuenta', '💵 Efectivo'])}</div>
      ${htmlFecha(b)}
      ${mostrarRecordar ? `
      <label class="recordar">
        <input type="checkbox" id="h-recordar" ${b.recordar ? 'checked' : ''}>
        <span>Recordar «${esc(clave.texto)}» como ${esc(cat.nombre)}</span>
      </label>` : ''}
      ${htmlAcciones(b, { deshabilitado: !cat })}`,
  };
}

function cuerpoHojaIngreso(b) {
  return {
    titulo: b.id ? 'Editar ingreso' : 'Añadir dinero',
    cuerpo: `
      ${htmlImporte(b)}
      <label class="campo">Concepto
        <input id="h-concepto" type="text" autocomplete="off" placeholder="Ej: paga, beca, Bizum de Ana" value="${esc(b.concepto)}">
      </label>
      <div class="campo"><span>¿Dónde entra?</span>${htmlSelectorMetodo(b, ['💳 Cuenta', '💵 Efectivo'])}</div>
      ${htmlFecha(b)}
      ${htmlAcciones(b)}`,
  };
}

function cuerpoHojaTraspaso(b) {
  return {
    titulo: b.id ? 'Editar traspaso' : 'Pasar dinero',
    cuerpo: `
      ${htmlImporte(b)}
      <div class="campo"><span>De dónde a dónde</span>
        ${htmlSelectorMetodo(b, ['💳 Cuenta → 💵 Efectivo', '💵 Efectivo → 💳 Cuenta'])}
      </div>
      <p class="nota nota-hoja">${b.metodo === 'cuenta' ? 'Por ejemplo, el dinero que sacas del cajero.' : 'Por ejemplo, el efectivo que ingresas en tu cuenta.'} No cuenta como gasto.</p>
      ${htmlFecha(b)}
      ${htmlAcciones(b)}`,
  };
}

function cuerpoHojaSaldo(b) {
  return {
    titulo: b.metodo === 'cuenta' ? 'Corregir saldo de la cuenta' : 'Corregir saldo en efectivo',
    cuerpo: `
      ${htmlImporte(b, true)}
      <p class="nota nota-hoja">Escribe lo que tienes ahora mismo. Los gastos anteriores no se vuelven a restar.</p>
      ${htmlAcciones(b)}`,
  };
}

function cuerpoHojaLimites(b) {
  const filas = CATEGORIAS.map((c) => `
    <div class="limite-fila">
      <span class="limite-nombre"><span class="gasto-icono mini" style="--c:${c.color}" aria-hidden="true">${c.emoji}</span>${esc(c.nombre)}</span>
      <span class="limite-entrada">
        <input type="text" inputmode="decimal" autocomplete="off" data-limite="${c.id}" value="${esc(b.valores[c.id])}"
               placeholder="Sin límite" aria-label="Límite mensual de ${esc(c.nombre)}">
        <span aria-hidden="true">€</span>
      </span>
    </div>`).join('');
  return {
    titulo: 'Límites mensuales',
    cuerpo: `
      <p class="nota nota-hoja">Cuánto quieres gastar como máximo cada mes en una categoría. Déjalo en blanco si no quieres límite. Vale para todos los meses.</p>
      <div class="limites-lista">${filas}</div>
      ${htmlAcciones(b)}`,
  };
}

function cuerpoHojaPago(b) {
  const editando = Boolean(b.id);
  const mensual = b.frecuencia === 'mensual';
  const opcion = (grupo, valor, texto, activo) =>
    `<button type="button" role="radio" data-hoja="${grupo}" data-valor="${valor}" aria-checked="${activo}">${texto}</button>`;

  // Fecha: al crear, la del primer pago; al editar un pago mensual, solo el día del mes
  const campoFecha = mensual && editando
    ? `<label class="campo">Día del mes
         <input id="h-dia" type="text" inputmode="numeric" maxlength="2" autocomplete="off" value="${esc(b.dia)}">
         <small class="nota-hoja-chica">En los meses que no tienen ese día (29, 30 o 31) se usa el último día.</small>
       </label>`
    : `<label class="campo">${mensual ? 'Primer pago' : 'Fecha del pago'}
         <input id="h-fecha" type="date" value="${esc(b.fecha)}">
         ${editando ? '' : `<small class="nota-hoja-chica">${mensual ? 'Después se repite cada mes ese mismo día. ' : ''}Si pones hoy o una fecha pasada, se apunta (o te lo pide) enseguida.</small>`}
       </label>`;

  const frecuencia = editando
    ? `<p class="nota nota-hoja">${mensual ? 'Se repite cada mes.' : 'Es un pago de una sola vez.'}</p>`
    : `<div class="campo"><span>¿Cada cuánto?</span>
         <div class="segmentado" role="radiogroup">${opcion('frecuencia', 'mensual', 'Cada mes', mensual)}${opcion('frecuencia', 'unico', 'Una sola vez', !mensual)}</div>
       </div>`;

  const opcionesAviso = [['', 'No avisar'], ['0', 'El mismo día'], ['1', '1 día antes'], ['2', '2 días antes'], ['3', '3 días antes'], ['7', '1 semana antes']]
    .map(([v, t]) => `<option value="${v}" ${b.aviso === v ? 'selected' : ''}>${t}</option>`).join('');

  const filas = Object.entries(b.exc).map(([mes, f]) => `
    <div class="exc-fila">
      <span class="exc-mes">${esc(fechaCorta(f.fecha))}<small>${esc(nombreMes(mes))}</small></span>
      <input type="text" inputmode="decimal" autocomplete="off" data-exc="${mes}" value="${esc(f.texto)}" ${f.omitir ? 'disabled' : ''}
             aria-label="Importe de ${esc(nombreMes(mes))}">
      <label class="exc-omitir"><input type="checkbox" data-exc-omitir="${mes}" ${f.omitir ? 'checked' : ''}> Omitir</label>
    </div>`).join('');

  return {
    titulo: editando ? 'Editar pago' : 'Nuevo pago',
    cuerpo: `
      ${htmlImporte(b)}
      <label class="campo">Concepto
        <input id="h-concepto" type="text" autocomplete="off" placeholder="Ej: gimnasio, Bizum a Ana" value="${esc(b.concepto)}">
      </label>
      <div class="campo"><span>Categoría</span>${htmlBloqueCategoria(b, { automatica: true })}</div>
      <div class="campo"><span>¿De dónde sale?</span>${htmlSelectorMetodo(b, ['💳 Cuenta', '💵 Efectivo'])}</div>
      ${frecuencia}
      ${campoFecha}
      <div class="campo"><span>¿Cómo se paga?</span>
        <div class="segmentado" role="radiogroup">${opcion('modo', 'auto', '🔁 Se apunta solo', b.modo === 'auto')}${opcion('modo', 'manual', '🙋 Lo pago yo', b.modo === 'manual')}</div>
        <small class="nota-hoja-chica">${b.modo === 'auto'
          ? 'Pago domiciliado: se registra como gasto el día que toca, sin que hagas nada.'
          : 'Por ejemplo un Bizum: te aviso y, cuando lo hayas pagado, lo confirmas con un toque.'}</small>
      </div>
      <label class="campo">Avisarme
        <select id="h-aviso">${opcionesAviso}</select>
        <small class="nota-hoja-chica">Los avisos del móvil se activan en la pestaña Pagos. Dentro de la app siempre verás los pagos pendientes.</small>
      </label>
      ${editando && filas ? `
      <div class="campo exc-cab"><span>Próximos pagos: cambia el importe de un mes (un extra) o sáltatelo</span>${filas}</div>` : ''}
      ${editando ? `
      <label class="recordar recordar-fila">
        <input type="checkbox" id="h-pausado" ${b.pausado ? 'checked' : ''}>
        <span>Pausar este pago (no se apunta ni avisa)</span>
      </label>
      <p class="nota-hoja-chica">Pausar: no se apunta ni avisa hasta que lo reactives, y se reanuda en el mes en que lo hagas. Eliminar: el pago no volverá a tocar, pero los gastos ya apuntados se quedan en el historial.</p>
      <button type="button" class="fila-boton" data-hoja="calendario">Añadir al calendario del móvil <small>alarma fiable</small></button>` : ''}
      ${htmlAcciones(b)}`,
  };
}

const CUERPOS_HOJA = { gasto: cuerpoHojaGasto, ingreso: cuerpoHojaIngreso, traspaso: cuerpoHojaTraspaso, saldo: cuerpoHojaSaldo, pago: cuerpoHojaPago, limites: cuerpoHojaLimites };

function renderHoja(primeraVez = false) {
  const { titulo, cuerpo } = CUERPOS_HOJA[borrador.tipo](borrador);
  const entrando = primeraVez ? 'entrando' : '';
  elHoja.innerHTML = `
    <div class="hoja-fondo ${entrando}" data-hoja="cerrar"></div>
    <section class="hoja ${entrando}" role="dialog" aria-modal="true" aria-labelledby="h-titulo" tabindex="-1">
      <div class="hoja-asa" aria-hidden="true"></div>
      <h2 id="h-titulo">${esc(titulo)}</h2>
      ${cuerpo}
    </section>`;
}

/* ---------- Eventos de la hoja ---------- */

elHoja.addEventListener('click', (e) => {
  const el = e.target.closest('[data-hoja]');
  if (!el || !borrador) return;
  switch (el.dataset.hoja) {
    case 'cerrar':
    case 'cancelar':
      cerrarHoja();
      break;
    case 'ver-cats':
      borrador.verCats = true;
      renderHoja();
      break;
    case 'cat':
      borrador.cat = el.dataset.cat;
      borrador.verCats = false;
      renderHoja();
      break;
    case 'metodo':
      borrador.metodo = el.dataset.valor;
      renderHoja();
      break;
    case 'signo': { // saldo: alternar entre positivo y negativo
      const t = borrador.importe.trim();
      borrador.importe = t.startsWith('-') ? t.slice(1) : `-${t}`;
      renderHoja();
      break;
    }
    case 'frecuencia':
      borrador.frecuencia = el.dataset.valor;
      renderHoja();
      break;
    case 'modo':
      borrador.modo = el.dataset.valor;
      // Si aún no has tocado el aviso, lo ajustamos: «lo pago yo» → el mismo día; «se apunta solo» → sin aviso
      if (!borrador.avisoTocado) borrador.aviso = borrador.modo === 'manual' ? '0' : '';
      renderHoja();
      break;
    case 'calendario':
      exportarCalendario([almacen.obtenerPago(borrador.id)]);
      break;
    case 'guardar':
      guardarHoja();
      break;
    case 'eliminar':
      eliminarDesdeHoja();
      break;
  }
});

elHoja.addEventListener('input', (e) => {
  if (!borrador) return;
  const el = e.target;
  if (el.id === 'h-importe') {
    borrador.importe = el.value;
    el.closest('.campo-importe').classList.remove('error');
    // En un pago, las filas de «próximos pagos» que no has tocado siguen al importe habitual
    if (borrador.tipo === 'pago') {
      for (const [mes, f] of Object.entries(borrador.exc)) {
        if (f.tocado || f.original || f.omitir) continue;
        f.texto = el.value;
        const campo = elHoja.querySelector(`[data-exc="${mes}"]`);
        if (campo) campo.value = el.value;
      }
    }
  } else if (el.id === 'h-concepto') {
    borrador.concepto = el.value;
  } else if (el.id === 'h-dia') {
    borrador.dia = el.value;
  } else if ('limite' in el.dataset) {
    borrador.valores[el.dataset.limite] = el.value;
    el.classList.remove('error');
  } else if ('exc' in el.dataset) {
    const f = borrador.exc[el.dataset.exc];
    f.texto = el.value;
    f.tocado = true;
  }
});

elHoja.addEventListener('change', (e) => {
  if (!borrador) return;
  const el = e.target;
  if (el.id === 'h-fecha') borrador.fecha = el.value;
  else if (el.id === 'h-recordar') borrador.recordar = el.checked;
  else if (el.id === 'h-aviso') { borrador.aviso = el.value; borrador.avisoTocado = true; }
  else if (el.id === 'h-pausado') borrador.pausado = el.checked;
  else if ('excOmitir' in el.dataset) {
    const f = borrador.exc[el.dataset.excOmitir];
    f.omitir = el.checked;
    f.tocado = true;
    const campo = elHoja.querySelector(`[data-exc="${el.dataset.excOmitir}"]`);
    if (campo) campo.disabled = el.checked;
  }
});

elHoja.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input:not([type="checkbox"])')) {
    e.preventDefault();
    guardarHoja();
  }
});
document.addEventListener('keydown', (e) => {
  if (!hojaAbierta) return;
  if (e.key === 'Escape') cerrarHoja();
  // Enter con el foco en la hoja (sin estar en un campo o botón) = Guardar
  else if (e.key === 'Enter' && !e.target.closest('input, button, select, textarea')) guardarHoja();
});

/* ---------- Guardar ---------- */

/** Marca el importe en rojo, enfoca el campo y avisa. */
function importeInvalido(mensaje) {
  elHoja.querySelector('.campo-importe').classList.add('error');
  elHoja.querySelector('#h-importe').focus();
  avisar(mensaje);
}

/** Texto del saldo que queda en un sitio, para el aviso tras guardar ("Cuenta: 1.250,00 €"). */
function detalleSaldo(metodo) {
  const s = almacen.saldoActual();
  if (!s) return undefined;
  return `${metodo === 'cuenta' ? 'En la cuenta' : 'En efectivo'}: ${formatearEuros(s[metodo])}`;
}

function guardarHoja() {
  if (!borrador) return;
  ({ gasto: guardarGasto, ingreso: guardarIngreso, traspaso: guardarTraspaso, saldo: guardarSaldo, pago: guardarPagoHoja, limites: guardarLimitesHoja })[borrador.tipo]();
}

function guardarGasto() {
  const b = borrador;
  const cent = parseImporte(b.importe);
  if (cent === null) return importeInvalido('El importe no es válido. Ejemplo: 12,50');
  if (!b.cat) return avisar('Elige una categoría para guardar el gasto.');

  const concepto = b.concepto.trim() || 'Sin concepto';
  const datos = { cent, concepto, cat: b.cat, metodo: b.metodo, fecha: b.fecha || fechaISO() };

  // Aprender: si la categoría elegida difiere de la propuesta y el usuario lo permite
  if (b.recordar && b.cat !== b.catInicial && palabraAprendible(concepto)) {
    aprender(concepto, b.cat, almacen.aprendido());
    almacen.guardarAprendido();
  }

  almacen.guardarPreferencia('metodo', b.metodo); // recordar la última opción usada
  pintarMetodo();

  const categoria = categoriaPorId(datos.cat);

  if (b.id) {
    almacen.actualizarGasto(b.id, datos);
    cerrarHoja();
    avisar('Cambios guardados.', undefined, [detalleSaldo(datos.metodo), textoLimite(datos.cat, mesDe(datos.fecha))]);
  } else {
    const gasto = almacen.agregarGasto(datos);
    elFrase.value = '';
    cerrarHoja();
    avisar(`Guardado: ${formatearEuros(cent)} · ${categoria.emoji} ${categoria.nombre}`, {
      texto: 'Deshacer',
      fn: () => {
        almacen.eliminarGasto(gasto.id);
        render();
      },
    }, [detalleSaldo(datos.metodo), textoLimite(datos.cat, mesDe(datos.fecha))]);
  }
  estado.mes = mesDe(datos.fecha); // mostrar el mes donde ha quedado el gasto
  render();
}

function guardarIngreso() {
  const b = borrador;
  const cent = parseImporte(b.importe);
  if (cent === null) return importeInvalido('El importe no es válido. Ejemplo: 50');

  const datos = { tipo: 'ingreso', cent, concepto: b.concepto.trim() || 'Ingreso', metodo: b.metodo, fecha: b.fecha || fechaISO() };
  if (b.id) {
    almacen.actualizarMovimiento(b.id, datos);
    cerrarHoja();
    avisar('Cambios guardados.', undefined, detalleSaldo(datos.metodo));
  } else {
    const mov = almacen.agregarMovimiento(datos);
    elFrase.value = '';
    cerrarHoja();
    avisar(`Ingreso guardado: +${formatearEuros(cent)}`, {
      texto: 'Deshacer',
      fn: () => {
        almacen.eliminarMovimiento(mov.id);
        render();
      },
    }, detalleSaldo(datos.metodo));
  }
  render();
}

function guardarTraspaso() {
  const b = borrador;
  const cent = parseImporte(b.importe);
  if (cent === null) return importeInvalido('El importe no es válido. Ejemplo: 40');

  const destino = b.metodo === 'cuenta' ? 'efectivo' : 'cuenta';
  const datos = {
    tipo: 'traspaso',
    cent,
    concepto: b.metodo === 'cuenta' ? 'Retirada de efectivo' : 'Ingreso en cuenta',
    metodo: b.metodo,
    destino,
    fecha: b.fecha || fechaISO(),
  };
  if (b.id) {
    almacen.actualizarMovimiento(b.id, datos);
    cerrarHoja();
    avisar('Cambios guardados.', undefined, detalleSaldo(destino));
  } else {
    const mov = almacen.agregarMovimiento(datos);
    elFrase.value = '';
    cerrarHoja();
    avisar(`Pasados ${formatearEuros(cent)}: ${nombreMetodo(b.metodo)} → ${nombreMetodo(destino)}`, {
      texto: 'Deshacer',
      fn: () => {
        almacen.eliminarMovimiento(mov.id);
        render();
      },
    }, detalleSaldo(destino));
  }
  render();
}

function guardarPagoHoja() {
  const b = borrador;
  const cent = parseImporte(b.importe);
  if (cent === null) return importeInvalido('El importe no es válido. Ejemplo: 10');

  const hoy = fechaISO();
  const existente = b.id ? almacen.obtenerPago(b.id) : null;

  // Fecha y día del mes
  let fecha;
  let dia;
  if (existente && b.frecuencia === 'mensual') {
    dia = Math.round(Number(b.dia));
    if (!(dia >= 1 && dia <= 31)) return avisar('El día del mes debe estar entre 1 y 31.');
    fecha = existente.fecha;
  } else {
    fecha = b.fecha;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return avisar('Elige la fecha del pago.');
    dia = Number(fecha.slice(8));
  }

  const concepto = b.concepto.trim() || 'Pago';
  const cat = b.cat ?? detectarCategoria(concepto, almacen.aprendido()) ?? 'otros';
  const aviso = b.aviso === '' ? null : Number(b.aviso);

  // Cambios de un mes concreto: solo se tocan las filas que has modificado; el resto se conserva
  const excepciones = { ...(existente?.excepciones ?? {}) };
  for (const [mes, f] of Object.entries(b.exc)) {
    if (!f.tocado) continue;
    delete excepciones[mes];
    if (f.omitir) excepciones[mes] = { omitir: true };
    else {
      const c = parseImporte(f.texto);
      if (c !== null && c !== cent) excepciones[mes] = { cent: c };
    }
  }

  const pago = {
    id: existente?.id ?? crearId(),
    concepto, cent, cat, metodo: b.metodo,
    frecuencia: b.frecuencia, dia, fecha,
    inicio: b.frecuencia === 'unico' ? fecha.slice(0, 7) : (existente?.inicio ?? fecha.slice(0, 7)),
    modo: b.modo, aviso, pausado: b.pausado,
    excepciones,
    hechas: { ...(existente?.hechas ?? {}) },
    aplazado: { ...(existente?.aplazado ?? {}) },
    creado: existente?.creado ?? Date.now(),
  };

  // Al reanudar un pago pausado, vuelve a funcionar en el MES EN QUE LO REACTIVAS: los meses anteriores
  // (los de la pausa) se descartan y el de este mes cuenta, aunque su día ya haya pasado. Si no quieres
  // que cuente este mes, marca «Omitir» en ese mes de «Próximos pagos» antes de guardar.
  if (existente?.pausado && !b.pausado) {
    const mesActual = hoy.slice(0, 7);
    for (const o of ocurrencias({ ...pago, pausado: false }, hoy)) {
      if (o.mes < mesActual) pago.hechas[o.mes] = { omitido: true };
    }
  }

  almacen.guardarPago(pago);
  const creados = aplicarPagosAutomaticos();
  sincronizarSW();
  cerrarHoja();

  const siguiente = proximaFecha(almacen.obtenerPago(pago.id), hoy);
  avisar(
    creados.length ? textoApuntados(creados) : existente ? 'Pago guardado.' : 'Pago creado.',
    undefined,
    siguiente ? `Próximo: ${fechaCorta(siguiente)}` : undefined,
  );
  render();
}

function guardarLimitesHoja() {
  const nuevos = {};
  for (const c of CATEGORIAS) {
    const texto = (borrador.valores[c.id] ?? '').trim();
    if (!texto) continue; // en blanco = sin límite
    const cent = parseImporte(texto);
    if (cent === null) {
      const campo = elHoja.querySelector(`[data-limite="${c.id}"]`);
      campo?.classList.add('error');
      campo?.focus();
      avisar(`El límite de ${c.nombre} no es válido. Ejemplo: 60`);
      return;
    }
    nuevos[c.id] = cent;
  }
  almacen.guardarLimites(nuevos);
  cerrarHoja();
  const n = Object.keys(nuevos).length;
  avisar(n ? `Límites guardados (${n}).` : 'Sin límites por categoría.');
  render();
}

function guardarSaldo() {
  const b = borrador;
  const cent = parseSaldo(b.importe);
  if (cent === null) return importeInvalido('Escribe un número válido. Ejemplo: 1250,50');
  almacen.corregirSaldo(b.metodo, cent);
  cerrarHoja();
  avisar('Saldo actualizado.');
  render();
}

function eliminarDesdeHoja() {
  const id = borrador?.id;
  if (!id) return;
  if (borrador.tipo === 'pago') { // los gastos que el pago ya generó se quedan en el historial
    const borrado = almacen.eliminarPago(id);
    sincronizarSW();
    cerrarHoja();
    render();
    if (borrado) {
      avisar(`Pago «${borrado.concepto}» eliminado.`, {
        texto: 'Deshacer',
        fn: () => {
          almacen.guardarPago(borrado);
          sincronizarSW();
          render();
        },
      }, 'Los gastos que ya había generado siguen en el historial.');
    }
    return;
  }
  const esGasto = borrador.tipo === 'gasto';
  const borrado = esGasto ? almacen.eliminarGasto(id) : almacen.eliminarMovimiento(id);
  cerrarHoja();
  render();
  if (borrado) {
    avisar(esGasto ? 'Gasto eliminado.' : 'Movimiento eliminado.', {
      texto: 'Deshacer',
      fn: () => {
        if (esGasto) almacen.restaurarGasto(borrado);
        else almacen.restaurarMovimiento(borrado);
        render();
      },
    });
  }
}

/* ============================================================
 * 4. Captura por frase
 * ============================================================ */

/** Marca en la barra inferior el método de pago activo. */
function pintarMetodo() {
  const actual = almacen.preferencia('metodo');
  document.querySelectorAll('#metodo [data-metodo]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.metodo === actual));
  });
}

$('#metodo').addEventListener('click', (e) => {
  const boton = e.target.closest('[data-metodo]');
  if (!boton) return;
  almacen.guardarPreferencia('metodo', boton.dataset.metodo);
  pintarMetodo();
});

$('#captura').addEventListener('submit', (e) => {
  e.preventDefault();
  const res = interpretarFrase(elFrase.value);
  if (!res.ok) {
    avisar(res.error);
    elFrase.focus();
    return;
  }
  elFrase.blur(); // cierra el teclado para que la hoja se vea entera

  // Ingresos y traspasos solo tienen sentido si se llevan los saldos
  if (res.tipo !== 'gasto' && !almacen.haySaldos()) {
    avisar('Primero apunta cuánto tienes, en la pestaña Cuentas.');
    irA('cuentas');
    return;
  }
  if (res.tipo === 'ingreso') return abrirHojaIngreso(res);
  if (res.tipo === 'traspaso') return abrirHojaTraspaso(res);

  const categoria = detectarCategoria(res.concepto, almacen.aprendido()); // null si no la reconoce
  abrirHojaNueva(res, categoria);
});

/* ============================================================
 * 5. Avisos y eventos globales
 * ============================================================ */

let temporizadorAviso;

/**
 * Muestra un aviso breve.
 * `accion` = { texto, fn } añade un botón (p. ej. Deshacer); `detalle` son líneas más pequeñas debajo (texto o lista).
 */
function avisar(texto, accion, detalle) {
  elAviso.innerHTML = `
    <div class="aviso-caja">
      <span class="aviso-texto">${esc(texto)}${[].concat(detalle ?? []).filter(Boolean).map((l) => `<small>${esc(l)}</small>`).join('')}</span>
      ${accion ? `<button type="button">${esc(accion.texto)}</button>` : ''}
    </div>`;
  elAviso.classList.toggle('arriba', hojaAbierta); // con una hoja abierta, arriba para no tapar sus botones
  elAviso.classList.add('visible');
  if (accion) {
    elAviso.querySelector('button').addEventListener('click', () => {
      accion.fn();
      elAviso.classList.remove('visible');
    });
  }
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => elAviso.classList.remove('visible'), accion ? 6000 : 3500);
}

window.addEventListener('almacen-error', () =>
  avisar('No se pudo guardar en el dispositivo. Comprueba el espacio libre.'),
);

// El aviso flota justo encima de la barra inferior, sea cual sea su altura
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--alto-dock', `${elDock.offsetHeight}px`);
}).observe(elDock);

/* ============================================================
 * 6. Arranque
 * ============================================================ */

// Colores: aplicar el tema guardado y seguir al sistema si el modo es Automático
registrarTemasPersonalizados(almacen.listarTemasPersonalizados());
aplicarTema(almacen.preferencia('tema'), almacen.preferencia('modo'));
vigilarSistema(() => {
  if (editor || almacen.preferencia('modo') !== 'auto') return; // el editor enseña un esquema fijo
  aplicarTema(almacen.preferencia('tema'), 'auto');
  if (estado.vista === 'ajustes') render();
});

// Botón "Instalar" propio (Chrome en Android lanza este evento si la app es instalable)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  estado.instalador = e;
  if (estado.vista === 'ajustes') render();
});

// Offline y avisos de pagos: registrar el service worker (solo funciona con HTTPS o localhost).
// Es un módulo ES para poder compartir la lógica de js/pagos.js con la app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('./service-worker.js', { type: 'module' });
      if (Notification.permission === 'granted') registrarSegundoPlano(); // se renueva en cada arranque
    } catch (err) {
      console.warn('Service worker no registrado:', err);
    }
  });
  // Mensajes del service worker: abrir una pestaña desde una notificación, o resultado de «Comprobar ahora»
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo === 'ir') irA(e.data.vista);
    else if (e.data?.tipo === 'revisado') {
      avisar(e.data.enviados ? `Se han enviado ${plural(e.data.enviados, 'aviso', 'avisos')}.` : 'No hay ningún pago que avisar ahora mismo.');
    }
  });
}

// Pedir al navegador que no borre los datos si hay poco espacio
navigator.storage?.persist?.();

// Pagos: apuntar los «se apunta solo» que ya tocan y dejar al día la copia para el service worker
const apuntadosAlArrancar = aplicarPagosAutomaticos();
sincronizarSW();

// Al volver a la app (otro día, tras minimizarla...), repetir la comprobación
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const creados = aplicarPagosAutomaticos();
  if (creados.length) avisar(textoApuntados(creados));
  if (!hojaAbierta && !editor) render();
  else pintarInsignia();
});

// Abrir directamente una pestaña (las notificaciones abren «?v=pagos»)
const vistaInicial = new URLSearchParams(location.search).get('v');
if (['resumen', 'historial', 'pagos', 'cuentas', 'ajustes'].includes(vistaInicial)) estado.vista = vistaInicial;

pintarMetodo();
render();
if (apuntadosAlArrancar.length) avisar(textoApuntados(apuntadosAlArrancar));
if (estado.vista === 'pagos') refrescarAvisos();
