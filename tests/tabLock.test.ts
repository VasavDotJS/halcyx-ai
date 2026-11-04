import { isFileBusyError } from '@/core/platform/sqlite';

jest.mock('expo-sqlite', () => ({}));
jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));

describe('web database handover', () => {
  it('recognises the "file held by another tab" errors it retries on', () => {
    expect(
      isFileBusyError(
        new Error(
          "Failed to execute 'createSyncAccessHandle' on 'FileSystemFileHandle': Access Handles cannot be created if there is another open Access Handle or Writable stream associated with the same file.",
        ),
      ),
    ).toBe(true);
    expect(isFileBusyError(new Error('Invalid VFS state'))).toBe(true);
    expect(isFileBusyError(new Error('no such table: tasks'))).toBe(false);
  });

  it('newest tab takes over and the owner steps aside', async () => {
    // Minimal Web Locks + BroadcastChannel stand-ins shared by two "tabs" in one process.
    const listeners = new Set<(e: { data: unknown }) => void>();
    class FakeChannel {
      private fn: ((e: { data: unknown }) => void) | null = null;
      postMessage(data: unknown) {
        for (const l of listeners) if (l !== this.fn) l({ data });
      }
      addEventListener(_t: string, fn: (e: { data: unknown }) => void) {
        this.fn = fn;
        listeners.add(fn);
      }
      close() {
        if (this.fn) listeners.delete(this.fn);
      }
    }
    let held: Promise<void> | null = null;
    const queue: (() => void)[] = [];
    const locks = {
      request: async (_n: string, _o: unknown, cb: () => Promise<void>) => {
        while (held) await new Promise<void>((r) => queue.push(r));
        held = cb();
        await held;
        held = null;
        queue.shift()?.();
      },
    };
    Object.assign(globalThis, { BroadcastChannel: FakeChannel });
    Object.defineProperty(globalThis, 'navigator', { value: { locks }, configurable: true });

    const { claimDatabaseTab } = jest.requireActual<typeof import('@/core/platform/tabLock.web')>('@/core/platform/tabLock.web');
    const yielded: string[] = [];
    await claimDatabaseTab(() => void yielded.push('first'));
    await claimDatabaseTab(() => void yielded.push('second'));
    expect(yielded).toEqual(['first']);
  });
});
