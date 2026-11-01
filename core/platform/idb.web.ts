/** Minimal promise wrapper around IndexedDB for the web/PWA build. */

const DB_NAME = 'halcyx';
const STORES = ['secrets', 'files', 'meta'] as const;
export type IdbStore = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function request<T>(store: IdbStore, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const idb = {
  get: <T>(store: IdbStore, key: string) => request<T | undefined>(store, 'readonly', (s) => s.get(key)),
  put: (store: IdbStore, key: string, value: unknown) => request<void>(store, 'readwrite', (s) => s.put(value, key)),
  del: (store: IdbStore, key: string) => request<void>(store, 'readwrite', (s) => s.delete(key)),
  keys: (store: IdbStore) => request<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()),
  clearAll: async () => {
    for (const s of STORES) await request<void>(s, 'readwrite', (st) => st.clear());
  },
};
