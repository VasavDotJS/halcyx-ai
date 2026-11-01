import type { Session } from '@supabase/supabase-js';
import { create } from 'zustand';

type SessionState = {
  ready: boolean;
  session: Session | null;
  locked: boolean;
  lastActiveAt: number;
  setSession: (s: Session | null) => void;
  setReady: () => void;
  lock: () => void;
  unlock: () => void;
  touch: () => void;
};

export const useSession = create<SessionState>()((set) => ({
  ready: false,
  session: null,
  locked: false,
  lastActiveAt: Date.now(),
  setSession: (session) => set({ session }),
  setReady: () => set({ ready: true }),
  lock: () => set({ locked: true }),
  unlock: () => set({ locked: false, lastActiveAt: Date.now() }),
  touch: () => set({ lastActiveAt: Date.now() }),
}));
