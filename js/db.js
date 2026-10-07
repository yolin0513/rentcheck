// IndexedDB 的薄包裝。
// 注意：這裡的資料只是「快取」——正本是最近一次傳出去的備份檔（見 docs/STATUS.md「備份是正本」）。

const DB_NAME = 'rentcheck';
const DB_VERSION = 1;
export const STORES = ['meta', 'tenants', 'payments', 'photos', 'log'];
let _db = null;

export function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('meta', { keyPath: 'k' });
      d.createObjectStore('tenants', { keyPath: 'id' });
      const p = d.createObjectStore('payments', { keyPath: 'id' });
      p.createIndex('month', 'month');
      d.createObjectStore('photos', { keyPath: 'id' });
      d.createObjectStore('log', { keyPath: 'seq', autoIncrement: true });
    };
    r.onsuccess = () => {
      _db = r.result;
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };
    r.onerror = () => reject(r.error);
  });
}

export const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** 一個交易：fn(stores) 同步排好要寫的東西；全部成功才算數（一起成功或一起失敗）。 */
export async function run(storeNames, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const s = Object.fromEntries(storeNames.map((n) => [n, t.objectStore(n)]));
    let out;
    try { out = fn(s, t); } catch (e) { try { t.abort(); } catch {} reject(e); return; }
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('交易中止'));
  });
}

export async function getAll(store) { const db = await open(); return req(db.transaction(store).objectStore(store).getAll()); }
export async function get(store, key) { const db = await open(); return req(db.transaction(store).objectStore(store).get(key)); }
export async function getByIndex(store, index, value) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).index(index).getAll(value));
}
export async function count(store) { const db = await open(); return req(db.transaction(store).objectStore(store).count()); }
