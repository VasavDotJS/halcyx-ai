import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import type { SqlDb, SqlValue } from './types';

/** expo-sqlite adapter. `secure_delete` zeroes freed pages so deleted ciphertext doesn't linger. */
export async function openSqlDb(name = 'halcyx.db'): Promise<SqlDb> {
  const db = await SQLite.openDatabaseAsync(name);
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
  };
}
