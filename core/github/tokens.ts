import type { SecretStore } from '@/core/platform/types';

/** GitHub App user-to-server token set. Access tokens expire (8h); refresh tokens rotate. */
export type GitHubTokens = {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch ms; null for non-expiring tokens. */
  expiresAt: number | null;
  refreshExpiresAt: number | null;
};

export type TokenExchange = {
  refresh(refreshToken: string): Promise<GitHubTokens>;
};

const NAME = 'github.tokens';
const SKEW_MS = 5 * 60_000;

export class GitHubTokenManager {
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly secrets: SecretStore,
    private readonly exchange: TokenExchange,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<GitHubTokens | null> {
    const raw = await this.secrets.get(NAME);
    return raw ? (JSON.parse(raw) as GitHubTokens) : null;
  }

  async save(tokens: GitHubTokens): Promise<void> {
    await this.secrets.set(NAME, JSON.stringify(tokens));
  }

  async clear(): Promise<void> {
    await this.secrets.remove(NAME);
  }

  async isConnected(): Promise<boolean> {
    return (await this.load()) !== null;
  }

  /** Returns a usable access token, refreshing it transparently when close to expiry. */
  async accessToken(): Promise<string> {
    if (this.inflight) return this.inflight;
    this.inflight = this.resolve().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async resolve(): Promise<string> {
    const t = await this.load();
    if (!t) throw new Error('GitHub is not connected.');
    if (t.expiresAt === null || t.expiresAt - SKEW_MS > this.now()) return t.accessToken;
    if (!t.refreshToken || (t.refreshExpiresAt !== null && t.refreshExpiresAt <= this.now())) {
      await this.clear();
      throw new Error('GitHub session expired. Please reconnect.');
    }
    const fresh = await this.exchange.refresh(t.refreshToken);
    await this.save(fresh);
    return fresh.accessToken;
  }
}
