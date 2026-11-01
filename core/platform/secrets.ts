import * as SecureStore from 'expo-secure-store';
import type { SecretStore } from './types';

/** iOS Keychain / Android Keystore. Items never sync to iCloud and are bound to this device. */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, '_');

export function createSecretStore(): SecretStore {
  return {
    hardwareBacked: true,
    get: (name) => SecureStore.getItemAsync(safeName(name), OPTIONS),
    set: (name, value) => SecureStore.setItemAsync(safeName(name), value, OPTIONS),
    remove: (name) => SecureStore.deleteItemAsync(safeName(name), OPTIONS),
  };
}
