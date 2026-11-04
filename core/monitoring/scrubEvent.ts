import { scrubString, scrubValue } from '@/core/security/scrub';

type Frame = { context_line?: string; pre_context?: string[]; post_context?: string[]; vars?: unknown; [k: string]: unknown };
type Stack = { frames?: Frame[] };
export type ScrubbableEvent = {
  message?: string;
  exception?: { values?: { value?: string; stacktrace?: Stack }[] };
  threads?: { values?: { stacktrace?: Stack }[] };
  request?: unknown;
  extra?: unknown;
  contexts?: unknown;
  breadcrumbs?: unknown;
};

/** Source lines and local variables in stack frames can contain user code or secrets; drop them. */
function scrubStack(st?: Stack): void {
  for (const f of st?.frames ?? []) {
    delete f.context_line;
    delete f.pre_context;
    delete f.post_context;
    delete f.vars;
  }
}

/** Removes anything that could carry keys, tokens or source code from a crash report. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.message) event.message = scrubString(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrubString(ex.value);
    scrubStack(ex.stacktrace);
  }
  for (const th of event.threads?.values ?? []) scrubStack(th.stacktrace);
  delete event.request;
  event.extra = scrubValue(event.extra) as T['extra'];
  event.contexts = scrubValue(event.contexts) as T['contexts'];
  return event;
}
