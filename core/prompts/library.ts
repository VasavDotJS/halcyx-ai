import type { Platform } from '@/core/platform/types';
import { randomId } from '@/core/security/crypto';
import { openLocal, sealLocal } from '@/core/security/dataKey';

export type SavedPrompt = { id: string; title: string; body: string; createdAt: number };

export type ProjectTemplate = { id: string; title: string; stack: string; prompt: string };

/** Starter templates for "describe an idea → working prototype". */
export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    id: 'nextjs',
    title: 'Next.js app',
    stack: 'Next.js · TypeScript · App Router',
    prompt:
      'Scaffold a Next.js (App Router, TypeScript, ESLint) app in this repository with a landing page, one API route and a Vitest test. Add a README with run instructions.',
  },
  {
    id: 'expo',
    title: 'Expo app',
    stack: 'Expo · React Native · TypeScript',
    prompt:
      'Scaffold an Expo (TypeScript, Expo Router) app with two tabs, a settings screen and a Jest test. Add a README with run instructions.',
  },
  {
    id: 'fastapi',
    title: 'FastAPI service',
    stack: 'Python · FastAPI · pytest',
    prompt:
      'Scaffold a FastAPI service with a health endpoint, one CRUD resource backed by SQLite, pytest tests and a Dockerfile. Add a README.',
  },
  {
    id: 'cli',
    title: 'Node CLI',
    stack: 'Node · TypeScript',
    prompt: 'Scaffold a TypeScript Node CLI with argument parsing, one command, unit tests and a README.',
  },
];

export const STARTER_PROMPT =
  'Read the README and the project structure, then fix one small, real issue (a typo, a failing test or a lint error) and summarise what you changed.';

/** Saved prompts are personal content, so bodies are sealed with the device key. */
export class PromptLibrary {
  constructor(private readonly p: Platform) {}

  async list(): Promise<SavedPrompt[]> {
    const rows = await this.p.db.all<{ id: string; title: string; body_enc: string; created_at: number }>(
      'SELECT * FROM prompts ORDER BY created_at DESC',
    );
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        title: r.title,
        body: await openLocal(this.p.secrets, r.body_enc, `prompt:${r.id}`),
        createdAt: r.created_at,
      })),
    );
  }

  async save(title: string, body: string): Promise<void> {
    const id = randomId(8);
    await this.p.db.run('INSERT INTO prompts (id, title, body_enc, created_at) VALUES (?, ?, ?, ?)', [
      id,
      title.slice(0, 80),
      await sealLocal(this.p.secrets, body, `prompt:${id}`),
      Date.now(),
    ]);
  }

  async remove(id: string): Promise<void> {
    await this.p.db.run('DELETE FROM prompts WHERE id = ?', [id]);
  }
}

export type RepoSettings = { provider: string | null; model: string | null; effort: string | null; instructions: string };

/** Per-repo defaults: last-used model + effort and the instruction file the agent always reads. */
export class RepoSettingsStore {
  constructor(private readonly p: Platform) {}

  async get(repoFull: string): Promise<RepoSettings> {
    const r = await this.p.db.get<{
      provider: string | null;
      model: string | null;
      effort: string | null;
      instructions_enc: string | null;
    }>('SELECT * FROM repo_settings WHERE repo_full = ?', [repoFull]);
    return {
      provider: r?.provider ?? null,
      model: r?.model ?? null,
      effort: r?.effort ?? null,
      instructions: r?.instructions_enc ? await openLocal(this.p.secrets, r.instructions_enc, `repo:${repoFull}`) : '',
    };
  }

  async rememberModel(repoFull: string, provider: string, model: string, effort: string): Promise<void> {
    await this.p.db.run(
      `INSERT INTO repo_settings (repo_full, provider, model, effort) VALUES (?, ?, ?, ?)
       ON CONFLICT(repo_full) DO UPDATE SET provider = excluded.provider, model = excluded.model, effort = excluded.effort`,
      [repoFull, provider, model, effort],
    );
  }

  async setInstructions(repoFull: string, text: string): Promise<void> {
    const sealed = await sealLocal(this.p.secrets, text, `repo:${repoFull}`);
    await this.p.db.run(
      `INSERT INTO repo_settings (repo_full, instructions_enc) VALUES (?, ?)
       ON CONFLICT(repo_full) DO UPDATE SET instructions_enc = excluded.instructions_enc`,
      [repoFull, sealed],
    );
  }
}
