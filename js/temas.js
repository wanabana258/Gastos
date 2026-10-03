/* ============================================================
 * temas.js — Paletas de colores de la app
 *
 * Cada tema define DOS esquemas (claro y oscuro) y una paleta para las
 * categorías. El usuario elige tema y modo (Automático / Claro / Oscuro)
 * en Ajustes → Apariencia.
 *
 * PARA AÑADIR UN TEMA: copia uno de los objetos de TEMAS, cámbiale el
 * `id` y los colores. Aparece solo en Ajustes. Todos los colores son
 * hex. Si cambias colores, comprueba que el texto se lee bien sobre su
 * fondo (contraste mínimo recomendado: 4,5 para texto normal).
 *
 * Significado de cada color de un esquema:
 *   fondo, superficie      Fondo de la app / de tarjetas y hojas
 *   tinta, tenue           Texto principal / texto secundario
 *   linea, realce          Separadores / fondos suaves (controles, pulsaciones)
 *   segActivo              Opción seleccionada en los controles segmentados
 *   boton, botonTexto      Botón principal (Guardar) y su texto
 *   dock, dockTexto        Barra inferior de captura y su texto
 *   dockTenue, dockCampo   Texto secundario en la barra / fondo del campo de texto
 *   dockSeg, dockSegTexto  Opción seleccionada del toggle Cuenta/Efectivo (si no se indica, usa enviar)
 *   enviar, enviarTexto    Botón de enviar (flecha) y su icono
 *   acento                 Detalles (casillas, icono de pestaña activa, foco)
 *   peligro                Eliminar y saldos en negativo
 * ============================================================ */

/* ---------- Paletas de categorías (11 colores, en el orden de CATEGORIAS) ---------- */
const ORDEN_CATEGORIAS = [
  'comida', 'super', 'transporte', 'deporte', 'suscripciones', 'estudios',
  'ocio', 'compras', 'salud', 'hogar', 'otros',
];

const PALETAS_CATEGORIAS = {
  vivo:   ['#f97316', '#22c55e', '#3b82f6', '#ef4444', '#a855f7', '#eab308', '#ec4899', '#14b8a6', '#84cc16', '#6366f1', '#94a3b8'],
  suave:  ['#f08a5d', '#6bbf8a', '#6c9be0', '#e5656b', '#a98be0', '#e6b94d', '#e57fb5', '#4fb5aa', '#9cc95a', '#7c86e0', '#9aa3b2'],
  tierra: ['#b97d7b', '#928e5e', '#6f8f8a', '#b5524f', '#8f7aa3', '#c9a24a', '#d68c95', '#5e8a6a', '#a8b26a', '#8b6f5a', '#a39e94'],
};

/* ---------- Temas ---------- */
export const TEMAS = [
  {
    id: 'tinta',
    nombre: 'Tinta',
    categorias: 'vivo',
    claro: {
      fondo: '#edeff4', superficie: '#ffffff', tinta: '#14161f', tenue: '#586377', linea: '#d9dce5', realce: '#e2e5ed',
      boton: '#14161f', botonTexto: '#f4f5f8',
      dock: '#14161f', dockTexto: '#f4f5f8', dockTenue: '#9aa2b5', dockCampo: '#272b39',
      enviar: '#f4f5f8', enviarTexto: '#14161f', acento: '#14161f', peligro: '#c4261d',
    },
    oscuro: {
      fondo: '#0d1017', superficie: '#171b25', tinta: '#eceef4', tenue: '#99a1b3', linea: '#272c3a', realce: '#202534', segActivo: '#2c3244',
      boton: '#eceef4', botonTexto: '#14161f',
      dock: '#232837', dockTexto: '#f1f3f8', dockTenue: '#9aa2b5', dockCampo: '#0f121a', dockSeg: '#3a4157', dockSegTexto: '#ffffff',
      enviar: '#ffffff', enviarTexto: '#14161f', acento: '#eceef4', peligro: '#ff6b61',
    },
  },
  {
    // Paleta "Matcha": Warm Fog #DDD3C9, Berry Good #ECC4C3, Usu Koubai Blossom #B97D7B,
    // Meadow Mauve #928E5E y Soldier Green #575527 (los tonos derivados están aclarados/oscurecidos a partir de ellos)
    id: 'matcha',
    nombre: 'Matcha fresa',
    categorias: 'tierra',
    claro: {
      fondo: '#ddd3c9', superficie: '#f3ede7', tinta: '#3b3a1e', tenue: '#54522a', linea: '#c7bbae', realce: '#d4cabf',
      boton: '#575527', botonTexto: '#f3ede7',
      dock: '#575527', dockTexto: '#f3ede7', dockTenue: '#e2c0bd', dockCampo: '#46441e',
      enviar: '#ecc4c3', enviarTexto: '#3b3a1e', acento: '#9c5e5c', peligro: '#963430',
    },
    oscuro: {
      fondo: '#1c1b0e', superficie: '#282716', tinta: '#eee5dc', tenue: '#b5ac93', linea: '#3a3920', realce: '#33321c', segActivo: '#46441f',
      boton: '#ecc4c3', botonTexto: '#2a2916',
      dock: '#3f3d1d', dockTexto: '#f3ede7', dockTenue: '#cdb7ae', dockCampo: '#26250f',
      enviar: '#ecc4c3', enviarTexto: '#2a2916', acento: '#ecc4c3', peligro: '#f08a84',
    },
  },
  {
    id: 'oceano',
    nombre: 'Océano',
    categorias: 'suave',
    claro: {
      fondo: '#e4eef1', superficie: '#f8fcfd', tinta: '#0f2a35', tenue: '#456370', linea: '#cbdce2', realce: '#d5e4e9',
      boton: '#0e5a6b', botonTexto: '#f2fafc',
      dock: '#0e4a59', dockTexto: '#f2fafc', dockTenue: '#a9cbd4', dockCampo: '#0a3a46',
      enviar: '#8fd3e0', enviarTexto: '#072a33', acento: '#0e7490', peligro: '#b42318',
    },
    oscuro: {
      fondo: '#08161b', superficie: '#0f2229', tinta: '#e3f1f5', tenue: '#8fb0ba', linea: '#1b3640', realce: '#173038',
      boton: '#8fd3e0', botonTexto: '#072a33',
      dock: '#14404c', dockTexto: '#eaf6f9', dockTenue: '#9cc3ce', dockCampo: '#0a1f26',
      enviar: '#8fd3e0', enviarTexto: '#072a33', acento: '#8fd3e0', peligro: '#ff8a80',
    },
  },
  {
    id: 'lavanda',
    nombre: 'Lavanda',
    categorias: 'suave',
    claro: {
      fondo: '#eeeaf6', superficie: '#fbf9ff', tinta: '#251b3d', tenue: '#655a82', linea: '#d9d2ea', realce: '#e2dcf0',
      boton: '#4b3a8c', botonTexto: '#fbf9ff',
      dock: '#3e2f78', dockTexto: '#fbf9ff', dockTenue: '#bdb2e0', dockCampo: '#2f2360',
      enviar: '#cfc3fa', enviarTexto: '#251b3d', acento: '#6a4fd0', peligro: '#b3261e',
    },
    oscuro: {
      fondo: '#14101f', superficie: '#1d1830', tinta: '#ece8f8', tenue: '#a69bc9', linea: '#2e2750', realce: '#272142',
      boton: '#cfc3fa', botonTexto: '#1d1830',
      dock: '#352c60', dockTexto: '#f2effc', dockTenue: '#b2a7d8', dockCampo: '#1a1530',
      enviar: '#cfc3fa', enviarTexto: '#1d1830', acento: '#cfc3fa', peligro: '#ff8f87',
    },
  },
  {
    id: 'atardecer',
    nombre: 'Atardecer',
    categorias: 'tierra',
    claro: {
      fondo: '#f6e9e0', superficie: '#fff9f5', tinta: '#3a1f18', tenue: '#7a5a4e', linea: '#e6d3c7', realce: '#eedbcf',
      boton: '#b8442b', botonTexto: '#fff9f5',
      dock: '#5c2b1f', dockTexto: '#fff3eb', dockTenue: '#e8bba6', dockCampo: '#46201a',
      enviar: '#ffb38a', enviarTexto: '#3a1f18', acento: '#b8442b', peligro: '#9e1f1f',
    },
    oscuro: {
      fondo: '#1a0f0b', superficie: '#26160f', tinta: '#fbebe1', tenue: '#c7a292', linea: '#3b2319', realce: '#33201a',
      boton: '#ffb38a', botonTexto: '#2a140c',
      dock: '#4a2418', dockTexto: '#fff1e8', dockTenue: '#e0b29e', dockCampo: '#2a140e',
      enviar: '#ffb38a', enviarTexto: '#2a140c', acento: '#ffb38a', peligro: '#ff8a80',
    },
  },
  {
    id: 'grafito',
    nombre: 'Grafito',
    categorias: 'vivo',
    claro: {
      fondo: '#f2f2f2', superficie: '#ffffff', tinta: '#111111', tenue: '#666666', linea: '#dddddd', realce: '#e6e6e6',
      boton: '#111111', botonTexto: '#ffffff',
      dock: '#111111', dockTexto: '#ffffff', dockTenue: '#a0a0a0', dockCampo: '#2a2a2a',
      enviar: '#ffffff', enviarTexto: '#111111', acento: '#111111', peligro: '#c62828',
    },
    oscuro: {
      fondo: '#000000', superficie: '#121212', tinta: '#f2f2f2', tenue: '#9a9a9a', linea: '#2a2a2a', realce: '#1c1c1c', segActivo: '#333333',
      boton: '#f2f2f2', botonTexto: '#111111',
      dock: '#1e1e1e', dockTexto: '#ffffff', dockTenue: '#a0a0a0', dockCampo: '#0a0a0a',
      enviar: '#ffffff', enviarTexto: '#111111', acento: '#ffffff', peligro: '#ff8a80',
    },
  },
];

export const MODOS = [
  { id: 'auto', nombre: 'Automático' },
  { id: 'claro', nombre: 'Claro' },
  { id: 'oscuro', nombre: 'Oscuro' },
];

/* ---------- Cálculo de variables CSS ---------- */

const CLAVE_CACHE = 'gastos-app/tema-vars';
const consultaOscuro = window.matchMedia('(prefers-color-scheme: dark)');

export const temaPorId = (id) => TEMAS.find((t) => t.id === id) ?? TEMAS[0];

/** ¿Hay que usar el esquema oscuro con este modo? ('auto' sigue al sistema) */
export const esOscuro = (modo) => modo === 'oscuro' || (modo === 'auto' && consultaOscuro.matches);

/** Esquema completo con valores por defecto para los colores opcionales. */
function esquemaCompleto(tema, esquema) {
  const e = tema[esquema];
  return {
    ...e,
    segActivo: e.segActivo ?? e.superficie,
    dockSeg: e.dockSeg ?? e.enviar,
    dockSegTexto: e.dockSegTexto ?? e.enviarTexto,
  };
}

/** Devuelve { '--fondo': '#...', ... } listo para aplicar al documento. */
export function variablesDe(tema, esquema) {
  const e = esquemaCompleto(tema, esquema);
  const vars = {
    '--fondo': e.fondo, '--superficie': e.superficie, '--tinta': e.tinta, '--tenue': e.tenue,
    '--linea': e.linea, '--realce': e.realce, '--seg': e.segActivo,
    '--boton': e.boton, '--boton-texto': e.botonTexto,
    '--dock': e.dock, '--dock-texto': e.dockTexto, '--dock-tenue': e.dockTenue, '--dock-campo': e.dockCampo,
    '--dock-seg': e.dockSeg, '--dock-seg-texto': e.dockSegTexto,
    '--enviar': e.enviar, '--enviar-texto': e.enviarTexto,
    '--acento': e.acento, '--peligro': e.peligro,
  };
  PALETAS_CATEGORIAS[tema.categorias].forEach((color, i) => {
    vars[`--c-${ORDEN_CATEGORIAS[i]}`] = color;
  });
  return vars;
}

/** Colores de muestra para la miniatura del selector de temas. */
export function muestraDe(tema, esquema) {
  const e = esquemaCompleto(tema, esquema);
  const cats = PALETAS_CATEGORIAS[tema.categorias];
  return { fondo: e.fondo, superficie: e.superficie, dock: e.dock, enviar: e.enviar, puntos: [cats[0], cats[1], cats[2], cats[4]] };
}

/**
 * Aplica tema y modo a toda la app. También guarda una copia de las variables
 * para que, la próxima vez, el pequeño script del <head> de index.html pinte
 * los colores correctos ANTES de que cargue el resto (sin parpadeo).
 */
export function aplicarTema(idTema, modo) {
  const tema = temaPorId(idTema);
  const esquema = esOscuro(modo) ? 'oscuro' : 'claro';
  const raiz = document.documentElement;

  for (const [nombre, valor] of Object.entries(variablesDe(tema, esquema))) raiz.style.setProperty(nombre, valor);
  raiz.style.colorScheme = esquema === 'oscuro' ? 'dark' : 'light'; // controles nativos (selector de fecha...) — CSS exige los valores en inglés

  // Color de la barra del navegador (Android)
  const fondo = tema[esquema].fondo;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', fondo));

  try {
    localStorage.setItem(
      CLAVE_CACHE,
      JSON.stringify({ modo, claro: variablesDe(tema, 'claro'), oscuro: variablesDe(tema, 'oscuro') }),
    );
  } catch { /* si no se puede guardar, no pasa nada */ }
}

/** Si el modo es Automático, repinta cuando el móvil cambia entre claro y oscuro. */
export function vigilarSistema(alCambiar) {
  consultaOscuro.addEventListener('change', alCambiar);
}
