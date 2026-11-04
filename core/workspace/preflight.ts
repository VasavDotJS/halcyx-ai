import { scanChanges, type SecretFinding } from '@/core/security/secretScanner';
import { utf8 } from '@/core/security/crypto';
import type { SandboxChecks } from '@/core/types';
import { isBinary } from './diff';
import type { FinalFile } from './store';

export const LARGE_FILE_WARN = 5 * 1024 * 1024;
/** GitHub rejects blobs over 100 MB. */
export const LARGE_FILE_BLOCK = 100 * 1024 * 1024;

/** Text files above this size aren't decoded for the secret scan on device. */
export const SCAN_FILE_LIMIT = 2 * 1024 * 1024;
/** Total bytes decoded per preflight run. */
export const SCAN_TOTAL_LIMIT = 64 * 1024 * 1024;

export type Preflight = {
  secrets: SecretFinding[];
  /** Text files too large to scan within the on-device budget; they block like secrets do. */
  unscanned: { path: string; bytes: number }[];
  largeFiles: { path: string; bytes: number; blocking: boolean }[];
  checks: SandboxChecks;
  /** Push is allowed only when this is false, or secrets are explicitly overridden. */
  blocked: boolean;
  blockReasons: string[];
  /** True when the only blockers are secret findings / unscanned files, which the user may override. */
  overridable: boolean;
};

/** Pre-push safety checks: secret scan, large files, sandbox lint/test status. */
export function preflight(files: FinalFile[], checks: SandboxChecks, overrideSecrets = false): Preflight {
  const unscanned: Preflight['unscanned'] = [];
  let budget = SCAN_TOTAL_LIMIT;
  const inputs = files
    .filter((f) => f.bytes !== null)
    .map((f) => {
      const bytes = f.bytes!;
      if (isBinary(bytes)) return { path: f.path, text: null };
      if (bytes.length > SCAN_FILE_LIMIT || bytes.length > budget) {
        unscanned.push({ path: f.path, bytes: bytes.length });
        return { path: f.path, text: null };
      }
      budget -= bytes.length;
      return { path: f.path, text: utf8.decode(bytes) };
    });
  const secrets = scanChanges(inputs);
  const largeFiles = files
    .filter((f) => f.bytes && f.bytes.length >= LARGE_FILE_WARN)
    .map((f) => ({ path: f.path, bytes: f.bytes!.length, blocking: f.bytes!.length >= LARGE_FILE_BLOCK }));

  const blockReasons: string[] = [];
  const hardBlock = largeFiles.some((f) => f.blocking) || !files.length;
  if (secrets.length && !overrideSecrets) blockReasons.push(`${secrets.length} possible secret(s) detected`);
  if (unscanned.length && !overrideSecrets) blockReasons.push(`${unscanned.length} file(s) too large to scan for secrets`);
  if (largeFiles.some((f) => f.blocking)) blockReasons.push('A file exceeds GitHub’s 100 MB limit');
  if (!files.length) blockReasons.push('No accepted changes');

  const blocked = blockReasons.length > 0;
  return { secrets, unscanned, largeFiles, checks, blocked, blockReasons, overridable: blocked && !hardBlock };
}
