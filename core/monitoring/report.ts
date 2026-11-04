import { scrubString } from '@/core/security/scrub';

/**
 * Background failures (cross-device notify, metadata reporting, push recovery, cleanup) must
 * never break the user's flow, but they must not vanish either. Core code reports here; the
 * app wires the sink to Sentry (scrubbed) at startup, so core never imports a vendor SDK.
 */
type Sink = (where: string, message: string) => void;

let sink: Sink = (where, message) => console.warn(`[halcyx] ${where}: ${message}`);

export function setErrorSink(next: Sink): void {
  sink = next;
}

export function reportError(where: string, e: unknown): void {
  const message = scrubString(e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 500);
  try {
    sink(where, message);
  } catch {
    // A failing sink must never throw into the caller.
  }
}

/** For promise chains: `.catch(reported('notify'))` instead of `.catch(() => undefined)`. */
export const reported =
  (where: string) =>
  (e: unknown): undefined => {
    reportError(where, e);
    return undefined;
  };
