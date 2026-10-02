/* ============================================================
 * categorias.js — Categorías, diccionario de palabras clave y aprendizaje
 *
 * Cómo se decide la categoría de un concepto (en este orden):
 *   1. Palabras APRENDIDAS (las que tú has elegido manualmente antes).
 *   2. Frases del diccionario con varias palabras ("amazon prime").
 *   3. Palabras sueltas del diccionario ("gimnasio", "guagua"...).
 *      Las palabras "genéricas" (ej. "compra") solo valen si no hay otra pista.
 * Si no hay coincidencia devuelve null y la app te pregunta.
 *
 * Todo funciona offline: no se usa ninguna API externa.
 *
 * PARA AÑADIR PALABRAS: edita DICCIONARIO más abajo. Puedes escribir con
 * tildes y mayúsculas; todo se normaliza solo. Los plurales ("libros",
 * "cervezas") se reconocen automáticamente a partir del singular.
 * ============================================================ */

export const CATEGORIAS = [
  { id: 'comida',        nombre: 'Comida fuera',     emoji: '🍔', color: '#f97316' },
  { id: 'super',         nombre: 'Supermercado',     emoji: '🛒', color: '#22c55e' },
  { id: 'transporte',    nombre: 'Transporte',       emoji: '🚌', color: '#3b82f6' },
  { id: 'deporte',       nombre: 'Deporte',          emoji: '💪', color: '#ef4444' },
  { id: 'suscripciones', nombre: 'Suscripciones',    emoji: '🔁', color: '#a855f7' },
  { id: 'estudios',      nombre: 'Estudios',         emoji: '📚', color: '#eab308' },
  { id: 'ocio',          nombre: 'Ocio y salidas',   emoji: '🎉', color: '#ec4899' },
  { id: 'compras',       nombre: 'Compras',          emoji: '🛍️', color: '#14b8a6' },
  { id: 'salud',         nombre: 'Salud y cuidado',  emoji: '💊', color: '#84cc16' },
  { id: 'hogar',         nombre: 'Hogar y facturas', emoji: '🏠', color: '#6366f1' },
  { id: 'otros',         nombre: 'Otros',            emoji: '📦', color: '#94a3b8' },
];

const POR_ID = new Map(CATEGORIAS.map((c) => [c.id, c]));

/** Devuelve la categoría por su id (si el id no existe, devuelve "Otros"). */
export const categoriaPorId = (id) => POR_ID.get(id) ?? POR_ID.get('otros');

/* ---------- Diccionario de palabras clave ---------- */
const DICCIONARIO = {
  comida:
    'cafetería, café, menú, restaurante, bar, tapas, tapa, cena, almuerzo, desayuno, bocadillo, bocata, ' +
    'pizza, pizzería, kebab, kebap, hamburguesa, burger, mcdonalds, mcdonald, burger king, kfc, telepizza, ' +
    'dominos, sushi, poke, helado, heladería, tostada, croissant, bollería, merienda, comer, cantina, comedor, ' +
    'glovo, just eat, uber eats, delivery, brunch, zumo, batido, refresco, vending, bubble tea, takeaway',
  super:
    'súper, supermercado, mercadona, lidl, carrefour, hiperdino, spar, alcampo, aldi, eroski, consum, hipercor, ' +
    'compra, fruta, verdura, frutería, carnicería, panadería, pan, leche, huevos, charcutería',
  transporte:
    'bus, guagua, titsa, tranvía, gasolina, gasoil, diésel, combustible, gasolinera, taxi, uber, cabify, bolt, ' +
    'parking, aparcamiento, metro, tren, renfe, billete, peaje, itv, bici, patinete, vuelo, avión, ferry, barco, ' +
    'binter, ryanair, vueling, alsa, blablacar, bono bus, bono guagua, abono transporte, abono bus',
  deporte:
    'gimnasio, gym, pádel, fútbol, baloncesto, piscina, crossfit, entrenador, entrenamiento, proteína, creatina, ' +
    'whey, running, raqueta, natación, yoga, pilates, escalada, boxeo, mma, spinning, decathlon, deporte, ' +
    'senderismo, surf, tenis, basket',
  suscripciones:
    'netflix, spotify, hbo, disney, disney plus, prime video, amazon prime, youtube premium, youtube, icloud, ' +
    'google one, chatgpt, claude, openai, github copilot, apple music, apple tv, apple one, twitch, crunchyroll, ' +
    'suscripción, dazn, filmin, audible, notion, duolingo, patreon, dropbox, vpn, nordvpn, paramount, ' +
    'movistar plus, ps plus, playstation plus, game pass, xbox game pass, nintendo online, tidal, deezer, ' +
    'canva pro, microsoft 365, office 365',
  estudios:
    'libro, fotocopias, fotocopia, copistería, apuntes, matrícula, material, papelería, impresión, imprimir, ' +
    'tasas, curso, udemy, coursera, bolígrafo, cuaderno, calculadora, carpeta, tfg, tfm, examen, academia, ' +
    'clases particulares, clase particular, estudios, máster, certificación, oposición',
  ocio:
    'cine, concierto, fiesta, discoteca, disco, copas, copa, birra, cerveza, cañas, caña, pub, entradas, entrada, ' +
    'teatro, ocio, salida, videojuego, juego, steam, playstation, xbox, nintendo, minecraft, bowling, ' +
    'escape room, karaoke, festival, botellón, ron, vodka, ginebra, alcohol, viaje, hotel, airbnb, excursión, ' +
    'playa, museo, parque, eshop, juegos de mesa, cumpleaños',
  compras:
    'ropa, zapatillas, zapatos, camiseta, pantalón, sudadera, chaqueta, zara, shein, amazon, pull&bear, bershka, ' +
    'primark, stradivarius, el corte inglés, regalo, cargador, auriculares, funda, ordenador, portátil, teclado, ' +
    'ratón, tecnología, aliexpress, temu, wallapop, vinted, mochila, perfume, pccomponentes, pc componentes, ' +
    'mediamarkt, media markt, disco duro, decoración',
  salud:
    'farmacia, médico, dentista, gafas, óptica, peluquería, barbería, fisio, fisioterapeuta, psicólogo, medicina, ' +
    'medicamento, pastillas, ibuprofeno, paracetamol, analítica, urgencias, hospital, clínica, vacuna, lentillas, ' +
    'higiene, champú, desodorante, maquillaje, depilación, tatuaje, masaje, spa, podólogo, cita médica',
  hogar:
    'alquiler, piso, luz, internet, wifi, fibra, factura, limpieza, comunidad, gas, butano, movistar, vodafone, ' +
    'orange, digi, yoigo, lowi, recarga, teléfono, ikea, fianza, hipoteca, seguro, lavandería, lavadora, ' +
    'bombilla, menaje, detergente, leroy merlin, bricolaje, electricidad, endesa, iberdrola, naturgy',
};

/** Palabras demasiado ambiguas: solo se usan si no hay ninguna otra pista. */
const GENERICAS = new Set(['compra', 'material', 'viaje', 'regalo', 'salida', 'cumpleaños'].map(normalizar));

/** Palabras que NO se aprenden (no dicen nada sobre la categoría). */
const PALABRAS_VACIAS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'en', 'con', 'para', 'por', 'al',
  'que', 'mis', 'uni', 'universidad', 'casa', 'amigos', 'amigas', 'tarde', 'noche', 'hoy', 'ayer',
  'mes', 'semana', 'pago', 'pagar', 'gasto', 'varios', 'otro', 'otra', 'sin', 'concepto',
]);

/* ---------- Normalización ---------- */

/** Minúsculas, sin tildes ni signos: "Cafetería, UNI!" → "cafeteria uni" */
export function normalizar(texto) {
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Formas de una palabra para tolerar plurales: "cervezas" → ["cervezas", "cerveza"] */
function variantes(p) {
  const v = [p];
  if (p.length > 3 && p.endsWith('es')) v.push(p.slice(0, -2));
  if (p.length > 3 && p.endsWith('s')) v.push(p.slice(0, -1));
  return v;
}

/* ---------- Índices del diccionario (se construyen una vez al cargar) ---------- */
const palabraACategoria = new Map(); // "gimnasio" → "deporte"
const frases = [];                   // [{ frase: "amazon prime", id: "suscripciones" }]

for (const [id, lista] of Object.entries(DICCIONARIO)) {
  for (const clave of lista.split(',').map(normalizar).filter(Boolean)) {
    if (clave.includes(' ')) frases.push({ frase: clave, id });
    else if (!palabraACategoria.has(clave)) palabraACategoria.set(clave, id);
  }
}
frases.sort((a, b) => b.frase.length - a.frase.length); // primero las frases más largas

/* ---------- API pública ---------- */

/**
 * Detecta la categoría de un concepto.
 * @param {string} concepto  Ej: "Cafetería uni"
 * @param {Object} aprendido Mapa palabra→idCategoría con lo que el usuario ha enseñado
 * @returns {string|null}    id de categoría, o null si no se reconoce
 */
export function detectarCategoria(concepto, aprendido = {}) {
  const norm = normalizar(concepto);
  if (!norm) return null;
  const palabras = norm.split(' ');

  // 1. Lo aprendido tiene prioridad (así puedes corregir el diccionario)
  for (const p of palabras) {
    for (const v of variantes(p)) {
      if (Object.hasOwn(aprendido, v) && POR_ID.has(aprendido[v])) return aprendido[v];
    }
  }
  // 2. Frases de varias palabras
  const texto = ` ${norm} `;
  for (const { frase, id } of frases) {
    if (texto.includes(` ${frase} `)) return id;
  }
  // 3. Palabras sueltas (la primera que coincida; las genéricas, como último recurso)
  let generica = null;
  for (const p of palabras) {
    for (const v of variantes(p)) {
      const id = palabraACategoria.get(v);
      if (!id) continue;
      if (GENERICAS.has(v)) generica ??= id;
      else return id;
    }
  }
  return generica;
}

/**
 * Palabras "significativas" de un concepto (las que se pueden aprender).
 * Devuelve [{ texto: "cafetería", norm: "cafeteria" }, ...] sin repetidas.
 */
export function palabrasClave(concepto) {
  const vistas = new Set();
  const resultado = [];
  for (const texto of String(concepto).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const norm = normalizar(texto);
    if (norm.length < 3 || /^\d+$/.test(norm) || PALABRAS_VACIAS.has(norm) || vistas.has(norm)) continue;
    vistas.add(norm);
    resultado.push({ texto, norm });
  }
  return resultado;
}

/**
 * La palabra que se aprende de un concepto: la PRIMERA significativa.
 * En español el sustantivo principal suele ir primero ("ramen con Pedro",
 * "peluquería de Ana"). Aprender todas las palabras contaminaría el
 * diccionario con nombres propios ("pedro" → Comida fuera).
 * Devuelve { texto, norm } o null si no hay ninguna palabra aprovechable.
 */
export function palabraAprendible(concepto) {
  return palabrasClave(concepto)[0] ?? null;
}

/**
 * Enseña a la app: asocia la palabra principal del concepto con una categoría.
 * Modifica el objeto `aprendido` recibido (luego hay que guardarlo).
 */
export function aprender(concepto, idCategoria, aprendido) {
  const clave = palabraAprendible(concepto);
  if (clave) aprendido[clave.norm] = idCategoria;
}
