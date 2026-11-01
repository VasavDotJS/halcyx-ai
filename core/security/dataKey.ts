import type { SecretStore } from '@/core/platform/types';
import { generateKeyMaterial, openText, sealText } from './crypto';

/**
 * Device data key: encrypts local history, queued prompts and per-repo instructions.
 * Workspaces do NOT use this key; each workspace has its own key so it can be shredded alone.
 */
const NAME = 'device-data-key';

export async function deviceKey(secrets: SecretStore): Promise<string> {
  const existing = await secrets.get(NAME);
  if (existing) return existing;
  const fresh = generateKeyMaterial();
  await secrets.set(NAME, fresh);
  return fresh;
}

export async function destroyDeviceKey(secrets: SecretStore): Promise<void> {
  await secrets.remove(NAME);
}

export async function sealLocal(secrets: SecretStore, text: string, aad: string): Promise<string> {
  return sealText(await deviceKey(secrets), text, aad);
}

export async function openLocal(secrets: SecretStore, sealed: string, aad: string): Promise<string> {
  return openText(await deviceKey(secrets), sealed, aad);
}
