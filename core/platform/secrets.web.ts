import { idb } from './idb.web';
import type { SecretStore } from './types';

/**
 * Web fallback: values are AES-GCM encrypted with a non-extractable CryptoKey that itself
 * lives in IndexedDB. This blocks casual disk inspection but not a script running in the
 * page, which is why the UI warns that web storage is less secure than a device keystore.
 */
const WRAP_KEY_ID = '__wrap_key__';

async function wrapKey(): Promise<CryptoKey> {
  const existing = await idb.get<CryptoKey>('meta', WRAP_KEY_ID);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idb.put('meta', WRAP_KEY_ID, key);
  return key;
}

type Sealed = { iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer };

export function createSecretStore(): SecretStore {
  return {
    hardwareBacked: false,
    async get(name) {
      const sealed = await idb.get<Sealed>('secrets', name);
      if (!sealed) return null;
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, await wrapKey(), sealed.data);
      return new TextDecoder().decode(plain);
    },
    async set(name, value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await wrapKey(), new TextEncoder().encode(value));
      await idb.put('secrets', name, { iv, data } satisfies Sealed);
    },
    async remove(name) {
      await idb.del('secrets', name);
    },
  };
}
