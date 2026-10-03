/* ============================================================
 * app.js — Interfaz y flujo principal
 *
 * Mapa del archivo:
 *   1. Estado y referencias al DOM
 *   2. Vistas: cabecera, Resumen, Historial, Cuentas, Ajustes
 *   3. Hoja inferior (gasto, ingreso, traspaso, corregir saldo)
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
import { TEMAS, MODOS, aplicarTema, vigilarSistema, esOscuro, muestraDe } from './temas.js';
import {
  esc, fechaISO, mesDe, mesActual, desplazarMes, nombreMes, etiquetaDia,
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
  vista: 'resumen',       // 'resumen' | 'historial' | 'cuentas' | 'ajustes'
  mes: mesActual(),       // mes que se está viendo ("AAAA-MM")
  filtroCat: '',          // id de categoría o '' (todas) — solo Historial
  filtroMetodo: '',       // 'cuenta' | 'efectivo' | '' (todos) — solo Historial
  instalador: null,       // evento "beforeinstallprompt" (para el botón Instalar)
};

// Vistas que no dependen del mes: en vez del selector de mes llevan un título
const TITULOS_SIN_MES = { cuentas: 'Cuentas', ajustes: 'Ajustes' };

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
  document.querySelectorAll('.tabs [data-vista]').forEach((b) => {
    if (b.dataset.vista === estado.vista) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  if (estado.vista === 'resumen') renderResumen();
  else if (estado.vista === 'historial') renderHistorial();
  else if (estado.vista === 'cuentas') renderCuentas();
  else renderAjustes();
}

function irA(vista) {
  estado.vista = vista;
  render();
  elVista.scrollTop = 0;
}

/* ---------- Cabecera (navegación entre meses) ---------- */
function renderCabecera() {
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
    elVista.innerHTML = htmlSaldoLinea() + htmlVacio(nombreMes(estado.mes));
    return;
  }
  const { entero, decimales } = partesNumero(r.total);
  const tipo = almacen.preferencia('grafica');

  elVista.innerHTML = `
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
    </section>`;
}

/* ---------- Historial ---------- */

function htmlFilaGasto(g) {
  const c = categoriaPorId(g.cat);
  return `
    <button type="button" class="gasto" data-accion="editar" data-id="${esc(g.id)}">
      <span class="gasto-icono" style="--c:${c.color}" aria-hidden="true">${c.emoji}</span>
      <span class="gasto-texto">
        <span class="gasto-concepto">${esc(g.concepto)}</span>
        <span class="gasto-sub">${esc(c.nombre)} · ${nombreMetodo(g.metodo)}</span>
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
  const tarjetasTema = TEMAS.map((t) => {
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
      <p class="ayuda">«Automático» sigue el modo claro u oscuro de tu móvil.</p>
    </section>

    <section class="bloque">
      <h2>Copia de seguridad</h2>
      <p class="nota">Tus datos solo están en este móvil. Guarda una copia de vez en cuando (${plural(total, 'gasto guardado', 'gastos guardados')}).</p>
      <button type="button" class="fila-boton" data-accion="exportar-json">Guardar copia completa <small>.json</small></button>
      <button type="button" class="fila-boton" data-accion="exportar-csv">Exportar gastos a Excel <small>.csv</small></button>
      <label class="fila-boton">Importar o restaurar copia <small>.json / .csv</small>
        <input type="file" id="archivo" accept=".json,.csv,application/json,text/csv" hidden>
      </label>
      <p class="ayuda">La copia completa incluye gastos, ingresos, saldos y palabras aprendidas. El CSV solo lleva los gastos.</p>
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

    <p class="version">Versión 2 · Todo se guarda solo en este dispositivo</p>`;
}

/* ---------- Eventos de las vistas (delegación) ---------- */

elCabecera.addEventListener('click', (e) => {
  const el = e.target.closest('[data-accion]');
  if (!el || el.disabled) return;
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
  const { accion, valor, cat, id, palabra, metodo } = el.dataset;

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
    if (!almacen.todosLosGastos().length && !almacen.listarMovimientos().length && !almacen.haySaldos()) {
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
window.addEventListener('popstate', () => cerrarHoja(true));

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

function cuerpoHojaGasto(b) {
  const cat = b.cat ? categoriaPorId(b.cat) : null;
  const clave = palabraAprendible(b.concepto);
  // Solo ofrecemos "recordar" si la categoría es distinta de la que se propuso al principio
  const mostrarRecordar = Boolean(cat) && b.cat !== b.catInicial && clave !== null;

  let bloqueCategoria;
  if (!cat || b.verCats) {
    bloqueCategoria = `
      ${!cat ? `<p class="aviso-cat">No sé en qué categoría va «${esc(b.concepto)}». Elige una y la recordaré.</p>` : ''}
      <div class="grid-cats">
        ${CATEGORIAS.map((c) => `
          <button type="button" class="opcion-cat ${c.id === b.cat ? 'activa' : ''}" style="--c:${c.color}" data-hoja="cat" data-cat="${c.id}">
            <span aria-hidden="true">${c.emoji}</span>${esc(c.nombre)}
          </button>`).join('')}
      </div>`;
  } else {
    bloqueCategoria = `
      <button type="button" class="chip-cat" style="--c:${cat.color}" data-hoja="ver-cats">
        <span>${cat.emoji} ${esc(cat.nombre)}</span><small>Cambiar</small>
      </button>`;
  }

  return {
    titulo: b.id ? 'Editar gasto' : 'Confirmar gasto',
    cuerpo: `
      ${htmlImporte(b)}
      <label class="campo">Concepto
        <input id="h-concepto" type="text" autocomplete="off" value="${esc(b.concepto)}">
      </label>
      <div class="campo"><span>Categoría</span>${bloqueCategoria}</div>
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

const CUERPOS_HOJA = { gasto: cuerpoHojaGasto, ingreso: cuerpoHojaIngreso, traspaso: cuerpoHojaTraspaso, saldo: cuerpoHojaSaldo };

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
  if (e.target.id === 'h-importe') {
    borrador.importe = e.target.value;
    e.target.closest('.campo-importe').classList.remove('error');
  } else if (e.target.id === 'h-concepto') {
    borrador.concepto = e.target.value;
  }
});

elHoja.addEventListener('change', (e) => {
  if (!borrador) return;
  if (e.target.id === 'h-fecha') borrador.fecha = e.target.value;
  else if (e.target.id === 'h-recordar') borrador.recordar = e.target.checked;
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
  ({ gasto: guardarGasto, ingreso: guardarIngreso, traspaso: guardarTraspaso, saldo: guardarSaldo })[borrador.tipo]();
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
    avisar('Cambios guardados.', undefined, detalleSaldo(datos.metodo));
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
    }, detalleSaldo(datos.metodo));
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
 * `accion` = { texto, fn } añade un botón (p. ej. Deshacer); `detalle` es una segunda línea más pequeña.
 */
function avisar(texto, accion, detalle) {
  elAviso.innerHTML = `
    <div class="aviso-caja">
      <span class="aviso-texto">${esc(texto)}${detalle ? `<small>${esc(detalle)}</small>` : ''}</span>
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
aplicarTema(almacen.preferencia('tema'), almacen.preferencia('modo'));
vigilarSistema(() => {
  if (almacen.preferencia('modo') !== 'auto') return;
  aplicarTema(almacen.preferencia('tema'), 'auto');
  if (estado.vista === 'ajustes') render();
});

// Botón "Instalar" propio (Chrome en Android lanza este evento si la app es instalable)
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  estado.instalador = e;
  if (estado.vista === 'ajustes') render();
});

// Offline: registrar el service worker (solo funciona con HTTPS o localhost)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker no registrado:', err));
  });
}

// Pedir al navegador que no borre los datos si hay poco espacio
navigator.storage?.persist?.();

pintarMetodo();
render();
