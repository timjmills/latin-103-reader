// IndexedDB helpers for the Latin 103 Reader cache. Promise wrappers only —
// all policy (what to cache, when to sync) lives in store.js.
//
// Stores
//   weeks        keyPath n
//   units        keyPath id            index week_n
//   highlights   keyPath id            index week_n
//   lookups      keyPath form
//   settings     keyPath key           (single row, key = 'settings')
//   alignments   keyPath [week_n, unit_id]   index week_n
//   pictures     keyPath id            index week_n   (+ url / url_exp: the last signed URL, so offline shows what the browser cached)
//   progress     keyPath unit_id       index week_n   (reading_progress: one row per sentence read)
//   meta         keyPath key           (user_id, user_email, texts_synced_at …)
//   outbox       keyPath seq (auto)    queued writes while offline

export const DB_NAME = 'latin103';
export const DB_VERSION = 3;   // 2: pictures; 3: progress
export const STORES = ['weeks', 'units', 'highlights', 'lookups', 'settings', 'alignments', 'pictures', 'progress', 'meta', 'outbox'];

let dbPromise = null;

function upgrade(idb) {
  const mk = (name, opts, indexes = []) => {
    if (idb.objectStoreNames.contains(name)) return;
    const s = idb.createObjectStore(name, opts);
    for (const [idx, path] of indexes) s.createIndex(idx, path, { unique: false });
  };
  mk('weeks', { keyPath: 'n' });
  mk('units', { keyPath: 'id' }, [['week_n', 'week_n']]);
  mk('highlights', { keyPath: 'id' }, [['week_n', 'week_n']]);
  mk('lookups', { keyPath: 'form' });
  mk('settings', { keyPath: 'key' });
  mk('alignments', { keyPath: ['week_n', 'unit_id'] }, [['week_n', 'week_n']]);
  mk('pictures', { keyPath: 'id' }, [['week_n', 'week_n']]);
  mk('progress', { keyPath: 'unit_id' }, [['week_n', 'week_n']]);
  mk('meta', { keyPath: 'key' });
  mk('outbox', { keyPath: 'seq', autoIncrement: true });
}

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => upgrade(req.result);
    req.onsuccess = () => {
      const idb = req.result;
      idb.onversionchange = () => idb.close();
      idb.onclose = () => { dbPromise = null; };
      resolve(idb);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab'));
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

async function withStore(name, mode, fn) {
  const idb = await open();
  const tx = idb.transaction(name, mode);
  const result = await fn(tx.objectStore(name), tx);
  await txDone(tx);
  return result;
}

export function get(store, key) {
  return withStore(store, 'readonly', (s) => reqToPromise(s.get(key)));
}

export function getAll(store) {
  return withStore(store, 'readonly', (s) => reqToPromise(s.getAll()));
}

export function getAllKeys(store) {
  return withStore(store, 'readonly', (s) => reqToPromise(s.getAllKeys()));
}

export function byIndex(store, index, value) {
  return withStore(store, 'readonly', (s) => reqToPromise(s.index(index).getAll(IDBKeyRange.only(value))));
}

export function countByIndex(store, index, value) {
  return withStore(store, 'readonly', (s) => reqToPromise(s.index(index).count(IDBKeyRange.only(value))));
}

export function put(store, value) {
  return withStore(store, 'readwrite', (s) => reqToPromise(s.put(value)));
}

export function putMany(store, values) {
  return withStore(store, 'readwrite', (s) => {
    for (const v of values) s.put(v);
  });
}

export function del(store, key) {
  return withStore(store, 'readwrite', (s) => reqToPromise(s.delete(key)));
}

export function delMany(store, keys) {
  return withStore(store, 'readwrite', (s) => {
    for (const k of keys) s.delete(k);
  });
}

export function clear(store) {
  return withStore(store, 'readwrite', (s) => reqToPromise(s.clear()));
}

/** Delete every row in `store` whose `index` equals `value`. */
export function deleteByIndex(store, index, value) {
  return withStore(store, 'readwrite', async (s) => {
    const keys = await reqToPromise(s.index(index).getAllKeys(IDBKeyRange.only(value)));
    for (const k of keys) s.delete(k);
    return keys.length;
  });
}

/** Atomically replace all rows of a week in `store` (units/highlights/alignments). */
export function replaceWeek(store, weekN, rows) {
  return withStore(store, 'readwrite', async (s) => {
    const keys = await reqToPromise(s.index('week_n').getAllKeys(IDBKeyRange.only(weekN)));
    for (const k of keys) s.delete(k);
    for (const r of rows) s.put(r);
  });
}

/** Wipe every store (logout). */
export async function clearAll() {
  const idb = await open();
  const tx = idb.transaction(STORES, 'readwrite');
  for (const name of STORES) tx.objectStore(name).clear();
  await txDone(tx);
}

/** Close and delete the whole database (used only by tests / hard reset). */
export async function destroy() {
  if (dbPromise) {
    try { (await dbPromise).close(); } catch { /* ignore */ }
    dbPromise = null;
  }
  await reqToPromise(indexedDB.deleteDatabase(DB_NAME));
}

// Small typed helpers for the meta store.
export async function getMeta(key) {
  const row = await get('meta', key);
  return row ? row.value : undefined;
}
export function setMeta(key, value) {
  return put('meta', { key, value });
}
