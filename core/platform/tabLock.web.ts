/**
 * On the web the encrypted SQLite file lives in OPFS, which only one tab may open at a time.
 * Opening a magic link (or a second tab) would otherwise fail with "Access Handles cannot be
 * created if there is another open Access Handle".
 *
 * The newest tab wins: it asks the current owner to step aside over a BroadcastChannel, then
 * takes an exclusive Web Lock. The owner closes its database and shows "open in another tab".
 * Locks are released automatically when a tab closes or navigates away.
 */
export class TabLockTimeout extends Error {
  constructor() {
    super('HALCYX is open in another tab. Close that tab, then try again here.');
  }
}

const NAME = 'halcyx-db';
const WAIT_MS = 10_000;

export async function claimDatabaseTab(onTakenOver: () => Promise<void> | void): Promise<void> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  if (!locks) return; // very old browsers: rely on open retries instead
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(NAME);
  const me = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const askOwnerToYield = () => channel?.postMessage({ type: 'takeover', from: me });

  await new Promise<void>((acquired, failed) => {
    askOwnerToYield();
    // Re-ask while waiting, in case the owner was still starting up when the first message went out.
    const nudge = setInterval(askOwnerToYield, 1_000);
    const timer = setTimeout(() => {
      clearInterval(nudge);
      failed(new TabLockTimeout());
    }, WAIT_MS);

    locks
      .request(NAME, { mode: 'exclusive' }, () => {
        clearInterval(nudge);
        clearTimeout(timer);
        acquired();
        // Hold the lock until a newer tab asks for it.
        return new Promise<void>((release) => {
          channel?.addEventListener('message', (e: MessageEvent<{ type?: string; from?: string }>) => {
            if (e.data?.type !== 'takeover' || e.data.from === me) return;
            // The owner reloads away (see yieldToNewerTab); unloading releases this lock and the
            // storage handles together. Release explicitly too, in case the callback doesn't navigate.
            void Promise.resolve(onTakenOver())
              .catch(() => undefined)
              .finally(() => release());
          });
        });
      })
      .catch((e: unknown) => {
        clearInterval(nudge);
        clearTimeout(timer);
        failed(e instanceof Error ? e : new Error(String(e)));
      });
  });
}
