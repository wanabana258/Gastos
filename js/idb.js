/* ============================================================
 * idb.js — Mini almacén clave→valor en IndexedDB
 *
 * ¿Para qué? El service worker (que comprueba los avisos de pagos con la app
 * cerrada) NO puede leer localStorage. Así que la app guarda aquí una copia
 * de los pagos cada vez que cambian, y el service worker la lee.
 *
 * Claves usadas:
 *   'pagos'     lista de pagos (copia escrita por la app)
 *   'avisados'  avisos ya enviados hoy, para no repetir (escrita por el service worker)
 * ============================================================ */

const BASE = 'gastos-app-sw';
const TABLA = 'kv';

function abrir() {
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(BASE, 1);
    peticion.onupgradeneeded = () => peticion.result.createObjectStore(TABLA);
    peticion.onsuccess = () => resolver(peticion.result);
    peticion.onerror = () => rechazar(peticion.error);
  });
}

export async function guardarKV(clave, valor) {
  const bd = await abrir();
  return new Promise((resolver, rechazar) => {
    const t = bd.transaction(TABLA, 'readwrite');
    t.objectStore(TABLA).put(valor, clave);
    t.oncomplete = () => { bd.close(); resolver(); };
    t.onerror = () => { bd.close(); rechazar(t.error); };
  });
}

export async function leerKV(clave) {
  const bd = await abrir();
  return new Promise((resolver, rechazar) => {
    const peticion = bd.transaction(TABLA).objectStore(TABLA).get(clave);
    peticion.onsuccess = () => { bd.close(); resolver(peticion.result); };
    peticion.onerror = () => { bd.close(); rechazar(peticion.error); };
  });
}
