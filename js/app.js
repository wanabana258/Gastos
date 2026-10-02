/* ============================================================
 * app.js — Interfaz y flujo principal
 *
 * Mapa del archivo:
 *   1. Estado y referencias al DOM
 *   2. Vistas: cabecera, Resumen, Historial, Ajustes
 *   3. Hoja de confirmación / edición de un gasto
 *   4. Captura por frase (el campo de texto de abajo)
 *   5. Avisos (toast) y eventos globales
 *   6. Arranque (service worker, instalación)
 *
 * Patrón usado: cada vista se "pinta" entera con una función render*()
 * que genera HTML, y los clics se gestionan por delegación de eventos
 * leyendo atributos data-accion. Es simple y suficiente para esta app.
 * ============================================================ */

import { CATEGORIAS, categoriaPorId, detectarCategoria, palabraAprendible, aprender } from './categorias.js';
import { interpretarFrase, parseImporte } from './parser.js';
import * as almacen from './almacen.js';
import { generarCSV, parsearCSV } from './csv.js';
import { htmlDonut, htmlBarras } from './graficas.js';
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
  vista: 'resumen',       // 'resumen' | 'historial' | 'ajustes'
  mes: mesActual(),       // mes que se está viendo ("AAAA-MM")
  filtroCat: '',          // id de categoría o '' (todas) — solo Historial
  filtroMetodo: '',       // 'cuenta' | 'efectivo' | '' (todos) — solo Historial
  instalador: null,       // evento "beforeinstallprompt" (para el botón Instalar)
};

const ICONO_ANTERIOR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const ICONO_SIGUIENTE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const ICONO_CERRAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

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
  else renderAjustes();
}

function irA(vista) {
  estado.vista = vista;
  render();
  elVista.scrollTop = 0;
}

/* ---------- Cabecera (navegación entre meses) ---------- */
function renderCabecera() {
  if (estado.vista === 'ajustes') {
    elCabecera.innerHTML = '<span></span><h1 class="titulo">Ajustes</h1><span></span>';
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

function renderResumen() {
  const r = resumenDelMes(estado.mes);
  if (!r.lista.length) {
    elVista.innerHTML = htmlVacio(nombreMes(estado.mes));
    return;
  }
  const { entero, decimales } = partesNumero(r.total);
  const tipo = almacen.preferencia('grafica');

  elVista.innerHTML = `
    <section class="total" aria-label="Total del mes">
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
        <span class="gasto-sub">${esc(c.nombre)} · ${g.metodo === 'efectivo' ? '💵 Efectivo' : '💳 Cuenta'}</span>
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

/* ---------- Ajustes ---------- */

function renderAjustes() {
  const palabras = Object.entries(almacen.aprendido()).sort(([a], [b]) => a.localeCompare(b, 'es'));
  const total = almacen.todosLosGastos().length;

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
      <h2>Copia de seguridad</h2>
      <p class="nota">Tus datos solo están en este móvil. Guarda una copia de vez en cuando (${plural(total, 'gasto guardado', 'gastos guardados')}).</p>
      <button type="button" class="fila-boton" data-accion="exportar-json">Guardar copia completa <small>.json</small></button>
      <button type="button" class="fila-boton" data-accion="exportar-csv">Exportar gastos a Excel <small>.csv</small></button>
      <label class="fila-boton">Importar o restaurar copia <small>.json / .csv</small>
        <input type="file" id="archivo" accept=".json,.csv,application/json,text/csv" hidden>
      </label>
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

    <p class="version">Versión 1 · Todo se guarda solo en este dispositivo</p>`;
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
  const { accion, valor, cat, id, palabra } = el.dataset;

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

/* ---------- Exportar / importar ---------- */

function exportar(formato) {
  if (!almacen.todosLosGastos().length) {
    avisar('Todavía no hay gastos que guardar.');
    return;
  }
  if (formato === 'csv') {
    descargarArchivo(`gastos-${fechaISO()}.csv`, generarCSV(almacen.todosLosGastos()), 'text/csv;charset=utf-8');
    avisar('Archivo CSV descargado.');
  } else {
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
    const partes = [`${plural(r.agregados, 'gasto importado', 'gastos importados')}`];
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
 * 3. Hoja de confirmación / edición
 *
 * `borrador` guarda lo que se está editando. Los campos de texto actualizan
 * el borrador al escribir, así podemos repintar la hoja (por ejemplo al
 * elegir categoría) sin perder lo escrito.
 * ============================================================ */

let borrador = null;
let hojaAbierta = false;

/** Nuevo gasto a partir de una frase interpretada. `catAuto` puede ser null (no reconocida). */
function abrirHojaNueva(res, catAuto) {
  borrador = {
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

function abrirHoja() {
  hojaAbierta = true;
  elHoja.hidden = false;
  renderHoja(true);
  // Entrada en el historial del navegador: así el botón "atrás" de Android cierra la hoja
  history.pushState({ hoja: true }, '');
  // Foco en la propia hoja (no abre el teclado ni dibuja anillos): los lectores de pantalla
  // se quedan dentro del diálogo y Enter confirma (ver el listener de teclado más abajo)
  elHoja.querySelector('.hoja')?.focus({ preventScroll: true });
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

function renderHoja(primeraVez = false) {
  const b = borrador;
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

  const metodo = (valor, texto) =>
    `<button type="button" role="radio" data-hoja="metodo" data-valor="${valor}" aria-checked="${b.metodo === valor}">${texto}</button>`;

  elHoja.innerHTML = `
    <div class="hoja-fondo ${primeraVez ? 'entrando' : ''}" data-hoja="cerrar"></div>
    <section class="hoja ${primeraVez ? 'entrando' : ''}" role="dialog" aria-modal="true" aria-labelledby="h-titulo" tabindex="-1">
      <div class="hoja-asa" aria-hidden="true"></div>
      <h2 id="h-titulo">${b.id ? 'Editar gasto' : 'Confirmar gasto'}</h2>

      <div class="campo-importe">
        <input id="h-importe" type="text" inputmode="decimal" autocomplete="off" aria-label="Importe en euros" value="${esc(b.importe)}">
        <span class="campo-importe-eur" aria-hidden="true">€</span>
      </div>

      <label class="campo">Concepto
        <input id="h-concepto" type="text" autocomplete="off" value="${esc(b.concepto)}">
      </label>

      <div class="campo">
        <span>Categoría</span>
        ${bloqueCategoria}
      </div>

      <div class="campo">
        <span>Método de pago</span>
        <div class="segmentado" role="radiogroup" aria-label="Método de pago">
          ${metodo('cuenta', '💳 Cuenta')}${metodo('efectivo', '💵 Efectivo')}
        </div>
      </div>

      <label class="campo">Fecha
        <input id="h-fecha" type="date" value="${esc(b.fecha)}" max="${fechaISO()}">
      </label>

      ${mostrarRecordar ? `
      <label class="recordar">
        <input type="checkbox" id="h-recordar" ${b.recordar ? 'checked' : ''}>
        <span>Recordar «${esc(clave.texto)}» como ${esc(cat.nombre)}</span>
      </label>` : ''}

      <div class="acciones">
        ${b.id
          ? '<button type="button" class="btn btn-peligro" data-hoja="eliminar">Eliminar</button>'
          : '<button type="button" class="btn btn-sec" data-hoja="cancelar">Cancelar</button>'}
        <button type="button" class="btn btn-prim" data-hoja="guardar" ${cat ? '' : 'disabled'}>Guardar</button>
      </div>
    </section>`;
}

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

function guardarHoja() {
  const b = borrador;
  if (!b) return;

  const cent = parseImporte(b.importe);
  if (cent === null) {
    elHoja.querySelector('.campo-importe').classList.add('error');
    elHoja.querySelector('#h-importe').focus();
    avisar('El importe no es válido. Ejemplo: 12,50');
    return;
  }
  if (!b.cat) {
    avisar('Elige una categoría para guardar el gasto.');
    return;
  }

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
  const mesGasto = mesDe(datos.fecha);

  if (b.id) {
    almacen.actualizarGasto(b.id, datos);
    cerrarHoja();
    avisar('Cambios guardados.');
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
    });
  }
  estado.mes = mesGasto; // mostrar el mes donde ha quedado el gasto
  render();
}

function eliminarDesdeHoja() {
  const id = borrador?.id;
  if (!id) return;
  const borrado = almacen.eliminarGasto(id);
  cerrarHoja();
  render();
  if (borrado) {
    avisar('Gasto eliminado.', {
      texto: 'Deshacer',
      fn: () => {
        almacen.restaurarGasto(borrado);
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
  const categoria = detectarCategoria(res.concepto, almacen.aprendido()); // null si no la reconoce
  elFrase.blur(); // cierra el teclado para que la hoja se vea entera
  abrirHojaNueva(res, categoria);
});

/* ============================================================
 * 5. Avisos y eventos globales
 * ============================================================ */

let temporizadorAviso;

/** Muestra un aviso breve. `accion` = { texto, fn } añade un botón (p. ej. Deshacer). */
function avisar(texto, accion) {
  elAviso.innerHTML = `<div class="aviso-caja"><span>${esc(texto)}</span>${accion ? `<button type="button">${esc(accion.texto)}</button>` : ''}</div>`;
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
