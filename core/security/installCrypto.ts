import { install } from 'react-native-quick-crypto';

/** Installs the native WebCrypto implementation as `globalThis.crypto` on iOS/Android. */
export function installCrypto(): void {
  if (!globalThis.crypto?.subtle) install();
}
