import { idb } from './idb.web';
import type { FileStore } from './types';

/** IndexedDB-backed file store for the PWA. Contents are already ciphertext. */
export function createFileStore(): FileStore {
  const allKeys = async () => (await idb.keys('files')).map(String);
  return {
    write: (path, bytes) => idb.put('files', path, bytes),
    async read(path) {
      const v = await idb.get<Uint8Array>('files', path);
      if (!v) throw new Error(`File not found: ${path}`);
      return v;
    },
    exists: async (path) => (await idb.get('files', path)) !== undefined,
    remove: (path) => idb.del('files', path),
    async removeDir(path) {
      for (const k of await allKeys()) if (k.startsWith(`${path}/`)) await idb.del('files', k);
    },
    list: async (dir) => (await allKeys()).filter((k) => !dir || k.startsWith(`${dir}/`)),
    size: async (path) => (await idb.get<Uint8Array>('files', path))?.byteLength ?? 0,
  };
}
