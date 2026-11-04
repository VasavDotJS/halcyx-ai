import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import type { SqlDb, SqlValue } from './types';

/** True for the OPFS error raised while another tab (or a page that is still unloading) holds the file. */
export function isFileBusyError(e: unknown): boolean {
  const m = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /createSyncAccessHandle|Access Handles? cannot be created|NoModificationAllowedError|Invalid VFS state|database is locked/i.test(
    m,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Opens the database, retrying briefly while a previous page releases the file (reloads, tab handover). */
async function openWithRetry(name: string): Promise<SQLite.SQLiteDatabase> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await SQLite.openDatabaseAsync(name);
    } catch (e) {
      if (!isFileBusyError(e) || attempt >= 24) throw e;
      await sleep(Math.min(1_000, 100 * (attempt + 1)));
    }
  }
}

/** expo-sqlite adapter. `secure_delete` zeroes freed pages so deleted ciphertext doesn't linger. */
export async function openSqlDb(name = 'halcyx.db'): Promise<SqlDb> {
  const db = await openWithRetry(name);
  // Web (wa-sqlite worker) has no exclusive transactions; serialise transactions with an in-process lock instead.
  let chain: Promise<unknown> = Promise.resolve();
  const webTransaction = (fn: () => Promise<void>) => {
    const next = chain.then(() => db.withTransactionAsync(fn));
    chain = next.catch(() => undefined);
    return next;
  };
  await db.execAsync(
    Platform.OS === 'web'
      ? 'PRAGMA secure_delete = ON; PRAGMA foreign_keys = ON;'
      : 'PRAGMA journal_mode = WAL; PRAGMA secure_delete = ON; PRAGMA foreign_keys = ON;',
  );
  return {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params: SqlValue[] = []) => {
      await db.runAsync(sql, params);
    },
    all: <T>(sql: string, params: SqlValue[] = []) => db.getAllAsync<T>(sql, params),
    get: async <T>(sql: string, params: SqlValue[] = []) => (await db.getFirstAsync<T>(sql, params)) ?? null,
    transaction: (fn) => (Platform.OS === 'web' ? webTransaction(fn) : db.withExclusiveTransactionAsync(async () => fn())),
    close: () => db.closeAsync(),
  };
}
