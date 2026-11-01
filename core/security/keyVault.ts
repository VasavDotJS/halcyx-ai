import type { Platform } from '@/core/platform/types';
import type { FetchLike } from '@/core/providers/http';
import { adapterFor } from '@/core/providers/registry';
import type { KeyValidation, ProviderId } from '@/core/types';
import { looksLikeKey } from './keyFormat';

/**
 * Provider API keys live only in the OS keystore (or encrypted IndexedDB on web). They are
 * read just-in-time for a request to that provider and are never sent anywhere else.
 */
const keyName = (p: ProviderId) => `provider-key.${p}`;
const statusKey = (p: ProviderId) => `keystatus.${p}`;

export class KeyVault {
  constructor(private readonly p: Platform) {}

  get(provider: ProviderId): Promise<string | null> {
    return this.p.secrets.get(keyName(provider));
  }

  async has(provider: ProviderId): Promise<boolean> {
    return (await this.get(provider)) !== null;
  }

  async set(provider: ProviderId, key: string): Promise<void> {
    const trimmed = key.trim();
    if (!looksLikeKey(provider, trimmed)) throw new Error('That doesn’t look like a valid key for this provider.');
    await this.p.secrets.set(keyName(provider), trimmed);
    await this.p.db.run('DELETE FROM kv WHERE key = ?', [statusKey(provider)]);
  }

  async remove(provider: ProviderId): Promise<void> {
    await this.p.secrets.remove(keyName(provider));
    await this.p.db.run('DELETE FROM kv WHERE key = ?', [statusKey(provider)]);
  }

  async status(provider: ProviderId): Promise<KeyValidation | null> {
    const row = await this.p.db.get<{ value: string }>('SELECT value FROM kv WHERE key = ?', [statusKey(provider)]);
    return row ? (JSON.parse(row.value) as KeyValidation) : null;
  }

  async validate(provider: ProviderId, fetchImpl: FetchLike, isWeb: boolean): Promise<KeyValidation> {
    const apiKey = await this.get(provider);
    const result: KeyValidation = apiKey
      ? await adapterFor(provider).validateKey({ apiKey, fetch: fetchImpl, isWeb })
      : { status: 'unknown', checkedAt: Date.now(), message: 'No key saved' };
    await this.p.db.run('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [statusKey(provider), JSON.stringify(result)]);
    return result;
  }

  /** Validates a candidate key before saving it (concierge flow). */
  async validateCandidate(provider: ProviderId, key: string, fetchImpl: FetchLike, isWeb: boolean): Promise<KeyValidation> {
    return adapterFor(provider).validateKey({ apiKey: key.trim(), fetch: fetchImpl, isWeb });
  }
}
