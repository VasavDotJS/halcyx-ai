import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FileStore, Platform, SecretStore, SqlDb, SqlValue } from '@/core/platform/types';

/** Real SQLite (node:sqlite) on a real file, so tests can inspect raw database bytes. */
export function createTestDb(path: string): SqlDb {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA secure_delete = ON;');
  const norm = (p: SqlValue[]) => p.map((v) => (v instanceof Uint8Array ? Buffer.from(v) : v));
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params = []) => {
      db.prepare(sql).run(...(norm(params) as never[]));
    },
    all: async <T>(sql: string, params: SqlValue[] = []) => db.prepare(sql).all(...(norm(params) as never[])) as T[],
    get: async <T>(sql: string, params: SqlValue[] = []) => (db.prepare(sql).get(...(norm(params) as never[])) as T | undefined) ?? null,
    transaction: async (fn) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export function createTestFiles(root: string): FileStore {
  const abs = (p: string) => join(root, p);
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir).flatMap((n) => {
          const full = join(dir, n);
          return statSync(full).isDirectory() ? walk(full) : [relative(root, full)];
        })
      : [];
  return {
    write: async (p, b) => {
      mkdirSync(dirname(abs(p)), { recursive: true });
      writeFileSync(abs(p), b);
    },
    read: async (p) => new Uint8Array(readFileSync(abs(p))),
    exists: async (p) => existsSync(abs(p)),
    remove: async (p) => rmSync(abs(p), { force: true }),
    removeDir: async (p) => rmSync(abs(p), { recursive: true, force: true }),
    list: async (d) => walk(d ? abs(d) : root),
    size: async (p) => (existsSync(abs(p)) ? statSync(abs(p)).size : 0),
  };
}

export class MemorySecrets implements SecretStore {
  readonly hardwareBacked = true;
  readonly map = new Map<string, string>();
  async get(n: string) {
    return this.map.get(n) ?? null;
  }
  async set(n: string, v: string) {
    this.map.set(n, v);
  }
  async remove(n: string) {
    this.map.delete(n);
  }
}

export type TestPlatform = Platform & { root: string; dbPath: string; secrets: MemorySecrets };

export function createTestPlatform(): TestPlatform {
  const root = mkdtempSync(join(tmpdir(), 'halcyx-'));
  const dbPath = join(root, 'halcyx.db');
  return { root, dbPath, db: createTestDb(dbPath), files: createTestFiles(join(root, 'files')), secrets: new MemorySecrets() };
}

/** Every byte on "disk" for this platform: DB file, WAL/journal and all cache files. */
export function readAllBytes(root: string): Buffer {
  const all: Buffer[] = [];
  const walk = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const full = join(dir, n);
      if (statSync(full).isDirectory()) walk(full);
      else all.push(readFileSync(full));
    }
  };
  walk(root);
  return Buffer.concat(all);
}
