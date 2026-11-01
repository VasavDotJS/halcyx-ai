/** Browsers ship WebCrypto natively. */
export function installCrypto(): void {
  if (!globalThis.crypto?.subtle) throw new Error('This browser does not support WebCrypto.');
}
