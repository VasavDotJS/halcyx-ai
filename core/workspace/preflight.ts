import { scanChanges, type SecretFinding } from '@/core/security/secretScanner';
import { utf8 } from '@/core/security/crypto';
import type { SandboxChecks } from '@/core/types';
import { isBinary } from './diff';
import type { FinalFile } from './store';

export const LARGE_FILE_WARN = 5 * 1024 * 1024;
/** GitHub rejects blobs over 100 MB. */
export const LARGE_FILE_BLOCK = 100 * 1024 * 1024;

export type Preflight = {
  secrets: SecretFinding[];
  largeFiles: { path: string; bytes: number; blocking: boolean }[];
  checks: SandboxChecks;
  /** Push is allowed only when this is false, or secrets are explicitly overridden. */
  blocked: boolean;
  blockReasons: string[];
};

/** Pre-push safety checks: secret scan, large files, sandbox lint/test status. */
export function preflight(files: FinalFile[], checks: SandboxChecks, overrideSecrets = false): Preflight {
  const secrets = scanChanges(
    files.filter((f) => f.bytes !== null).map((f) => ({ path: f.path, text: isBinary(f.bytes!) ? null : utf8.decode(f.bytes!) })),
  );
  const largeFiles = files
    .filter((f) => f.bytes && f.bytes.length >= LARGE_FILE_WARN)
    .map((f) => ({ path: f.path, bytes: f.bytes!.length, blocking: f.bytes!.length >= LARGE_FILE_BLOCK }));

  const blockReasons: string[] = [];
  if (secrets.length && !overrideSecrets) blockReasons.push(`${secrets.length} possible secret(s) detected`);
  if (largeFiles.some((f) => f.blocking)) blockReasons.push('A file exceeds GitHub’s 100 MB limit');
  if (!files.length) blockReasons.push('No accepted changes');

  return { secrets, largeFiles, checks, blocked: blockReasons.length > 0, blockReasons };
}
