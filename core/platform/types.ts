/**
 * Platform ports. Core logic depends only on these interfaces; native, web and test
 * implementations live next to them. This keeps the security-critical code testable in Node.
 */

export type SqlValue = string | number | null | Uint8Array;

export interface SqlDb {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<void>;
  all<T>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T>(sql: string, params?: SqlValue[]): Promise<T | null>;
  transaction(fn: () => Promise<void>): Promise<void>;
  /** Releases the underlying file (web: lets another tab open it). */
  close?(): Promise<void>;
}

export interface FileStore {
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
  /** Removes a directory and everything below it. */
  removeDir(path: string): Promise<void>;
  /** Lists file paths (recursive) below a directory, relative to the store root. */
  list(dir: string): Promise<string[]>;
  size(path: string): Promise<number>;
}

export interface SecretStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  remove(name: string): Promise<void>;
  /** True when values are protected by the OS keystore (false on web). */
  readonly hardwareBacked: boolean;
}

export type Platform = { db: SqlDb; files: FileStore; secrets: SecretStore };
