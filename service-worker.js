/* ============================================================
 * service-worker.js — Offline + avisos de pagos
 *
 * Hace dos cosas:
 *
 * 1) OFFLINE (estrategia «stale-while-revalidate»):
 *    responde al instante con la copia guardada y, en segundo plano, descarga la
 *    versión nueva. Los cambios que hagas en el código se ven al abrir la app
 *    dos veces.
 *
 * 2) AVISOS DE PAGOS con la app cerrada:
 *    Chrome despierta este archivo de vez en cuando («periodic background sync»,
 *    solo en la app instalada) y aquí se comprueba qué pagos tocan. Android decide
 *    CUÁNDO: puede tardar horas, así que para alarmas exactas usa el calendario.
 *    También se puede forzar la comprobación desde la app (mensaje 'revisar').
 *
 * Es un MÓDULO ES (por eso app.js lo registra con { type: 'module' }): así
 * comparte con la app la lógica de js/pagos.js.
 *
 * IMPORTANTE: si AÑADES o RENOMBRAS archivos, súbelos, añádelos a ARCHIVOS y
 * cambia VERSION (por ejemplo a 'v6'). Los datos NO se tocan nunca.
 * ============================================================ */

import { calcularEstado, cuando } from './js/pagos.js';
import { leerKV, guardarKV } from './js/idb.js';
import { fechaISO, formatearEuros } from './js/utils.js';

const VERSION = 'v5';
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
  './js/pagos.js',
  './js/analisis.js',
  './js/idb.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

/* ---------- Offline ---------- */

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

/* ---------- Avisos de pagos ---------- */

/** Título y texto de la notificación de una ocurrencia. */
function textoAviso(o, tipo) {
  const importe = formatearEuros(o.cent);
  if (tipo === 'aviso') {
    return { titulo: `Se cobra ${cuando(o.dias)}: ${o.pago.concepto}`, cuerpo: `${importe} · se apuntará solo` };
  }
  const titulo = o.dias < 0 ? `Pago pendiente: ${o.pago.concepto}` : o.dias === 0 ? `Hoy toca pagar: ${o.pago.concepto}` : `Pagar ${cuando(o.dias)}: ${o.pago.concepto}`;
  return { titulo, cuerpo: `${importe} · tienes que hacerlo tú` };
}

/**
 * Comprueba los pagos y muestra los avisos que toquen hoy. Devuelve cuántos mostró.
 *  - Pagos «lo pago yo»: el día del aviso, el día del pago y un día después si sigue sin pagar.
 *  - Pagos «se apunta solo»: solo el día del aviso previo.
 * Cada aviso se envía como mucho una vez al día.
 */
async function revisarPagos() {
  if (self.Notification?.permission !== 'granted') return 0;

  const pagos = (await leerKV('pagos')) ?? [];
  const hoy = fechaISO();
  const { pendientes, avisos } = calcularEstado(pagos, hoy);
  const yaAvisados = (await leerKV('avisados')) ?? {};
  const vigentes = {};
  let enviados = 0;

  const candidatos = [
    ...pendientes.map((o) => ({ o, tipo: 'pendiente' })),
    ...avisos.map((o) => ({ o, tipo: 'aviso' })),
  ];
  for (const { o, tipo } of candidatos) {
    if (o.pago.aviso == null) continue; // este pago no quiere avisos del móvil
    const toca = tipo === 'pendiente' ? [o.pago.aviso, 0, -1].includes(o.dias) : o.dias === o.pago.aviso;
    if (!toca) continue;

    const clave = `${o.pago.id}|${o.mes}|${tipo}|${o.dias}`;
    vigentes[clave] = hoy;
    if (yaAvisados[clave] === hoy) continue;

    const { titulo, cuerpo } = textoAviso(o, tipo);
    await self.registration.showNotification(titulo, {
      body: cuerpo,
      tag: clave,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      data: { vista: 'pagos' },
    });
    enviados++;
  }
  await guardarKV('avisados', vigentes); // solo se conservan los de hoy
  return enviados;
}

// Chrome despierta el service worker periódicamente (si la app está instalada y lo permite)
self.addEventListener('periodicsync', (evento) => {
  if (evento.tag === 'revisar-pagos') evento.waitUntil(revisarPagos());
});

// La app puede pedir una comprobación inmediata
self.addEventListener('message', (evento) => {
  if (evento.data?.tipo !== 'revisar') return;
  evento.waitUntil(
    revisarPagos().then((enviados) => evento.source?.postMessage({ tipo: 'revisado', enviados })),
  );
});

// Al tocar la notificación: abrir la app en la pestaña Pagos
self.addEventListener('notificationclick', (evento) => {
  evento.notification.close();
  evento.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const v of ventanas) {
        if ('focus' in v) {
          await v.focus();
          v.postMessage({ tipo: 'ir', vista: evento.notification.data?.vista ?? 'pagos' });
          return;
        }
      }
      await self.clients.openWindow(new URL('./?v=pagos', self.registration.scope).href);
    })(),
  );
});
