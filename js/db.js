// Accès IndexedDB. Les écritures groupées passent par une seule transaction
// (tout ou rien) pour éviter les données incohérentes.

export const DB_NAME = 'popote';
export const DB_VERSION = 1;
export const STORES = ['recipes', 'ingredients', 'products', 'stock', 'weeks', 'shopping', 'movements', 'photos', 'kv'];

let dbPromise = null;

export function openDB(idb = globalThis.indexedDB) {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!idb) { reject(new Error('IndexedDB indisponible sur cet appareil.')); return; }
    const req = idb.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      // Migrations additives uniquement : on ne supprime jamais un magasin existant.
      if (ev.oldVersion < 1) {
        for (const s of ['recipes', 'ingredients', 'products', 'stock', 'weeks', 'photos', 'kv']) {
          db.createObjectStore(s, { keyPath: 'id' });
        }
        const sh = db.createObjectStore('shopping', { keyPath: 'id' });
        sh.createIndex('weekId', 'weekId');
        const mv = db.createObjectStore('movements', { keyPath: 'id' });
        mv.createIndex('weekId', 'weekId');
        mv.createIndex('entryId', 'entryId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet.'));
  });
  return dbPromise;
}

export function resetDBHandle() { dbPromise = null; }

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function getAll(store) {
  const db = await openDB();
  return reqP(db.transaction(store, 'readonly').objectStore(store).getAll());
}

export async function get(store, id) {
  const db = await openDB();
  return reqP(db.transaction(store, 'readonly').objectStore(store).get(id));
}

// ops : [{ store, put: obj } | { store, del: id } | { store, clear: true }]
export async function write(ops) {
  if (!ops.length) return;
  const db = await openDB();
  const names = [...new Set(ops.map(o => o.store))];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction annulée'));
    try {
      for (const o of ops) {
        const s = tx.objectStore(o.store);
        if (o.clear) s.clear();
        else if (o.del !== undefined) s.delete(o.del);
        else s.put(o.put);
      }
    } catch (e) { try { tx.abort(); } catch { /* déjà terminée */ } reject(e); }
  });
}

export async function loadAll() {
  const out = {};
  for (const s of STORES) if (s !== 'photos') out[s] = await getAll(s);
  return out;
}
