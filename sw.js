/* ============================================================
 * sw.js — Service worker: hace que la app funcione SIN conexión
 *
 * Estrategia "stale-while-revalidate" para los archivos de la app:
 *   1. Responde al instante con la copia guardada (rápido y offline).
 *   2. En segundo plano descarga la versión nueva y actualiza la copia.
 *   → Los cambios que hagas en el código se ven al abrir la app dos veces.
 *
 * IMPORTANTE: si AÑADES o RENOMBRAS archivos, súbelos y cambia VERSION
 * (por ejemplo a 'v2') y añádelos a ARCHIVOS: así se vuelve a precachear todo.
 * Los datos de gastos NO se tocan nunca (viven en localStorage).
 * ============================================================ */

const VERSION = 'v2';
const CACHE = `gastos-${VERSION}`;

// Todo lo necesario para arrancar sin internet (rutas relativas: valen en GitHub Pages)
const ARCHIVOS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/estilos.css',
  './js/app.js',
  './js/utils.js',
  './js/categorias.js',
  './js/parser.js',
  './js/almacen.js',
  './js/csv.js',
  './js/graficas.js',
  './js/temas.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Instalación: guardar todos los archivos en la caché
self.addEventListener('install', (evento) => {
  evento.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

// Activación: borrar cachés de versiones anteriores y tomar el control
self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Peticiones: caché primero, y refresco en segundo plano
self.addEventListener('fetch', (evento) => {
  const peticion = evento.request;
  if (peticion.method !== 'GET' || new URL(peticion.url).origin !== self.location.origin) return;

  evento.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const guardada = await cache.match(peticion, { ignoreSearch: true });
      const red = fetch(peticion)
        .then((respuesta) => {
          if (respuesta.ok) cache.put(peticion, respuesta.clone());
          return respuesta;
        })
        .catch(() => null);

      if (guardada) {
        evento.waitUntil(red); // deja que termine la actualización en segundo plano
        return guardada;
      }
      // Sin copia guardada: probar la red; si falla (offline), volver a la página principal
      return (await red) ?? (await cache.match('./index.html')) ?? Response.error();
    }),
  );
});
