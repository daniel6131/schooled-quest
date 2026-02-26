'use client';

import { EntryShell } from '@/components/entry/EntryShell';
import {
  GlowCard,
  GlowInput,
  GradientTitle,
  ShimmerButton,
  SubtleLead,
} from '@/components/entry/primitives';
import { ArrowLeft } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState, useSyncExternalStore } from 'react';

const LS_NAME = 'sq_name_last';
const LOCAL_STORAGE_EVENT = 'sq:localstorage';

function cleanCode(raw: string) {
  return raw
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 5);
}

// function setLocalStorageString(key: string, value: string) {
//   localStorage.setItem(key, value);
//   window.dispatchEvent(new Event(LOCAL_STORAGE_EVENT));
// }

function useLocalStorageString(key: string, fallback = '') {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener('storage', onStoreChange);
      window.addEventListener(LOCAL_STORAGE_EVENT, onStoreChange);
      return () => {
        window.removeEventListener('storage', onStoreChange);
        window.removeEventListener(LOCAL_STORAGE_EVENT, onStoreChange);
      };
    },
    () => (typeof window === 'undefined' ? fallback : (localStorage.getItem(key) ?? fallback)),
    () => fallback
  );
}

export default function JoinClient() {
  const router = useRouter();
  const params = useSearchParams();
  const savedName = useLocalStorageString(LS_NAME, '');

  // Prefer query param, fallback to saved name
  const name = (params.get('name') || savedName).trim();

  const [code, setCode] = useState('');
  const normalizedCode = useMemo(() => cleanCode(code), [code]);
  const codeOk = normalizedCode.length >= 4;

  function join() {
    if (!name || !codeOk) return;
    router.push(`/play/${normalizedCode}?name=${encodeURIComponent(name)}`);
  }

  return (
    <EntryShell>
      <GlowCard>
        <GradientTitle>Join a room</GradientTitle>
        <SubtleLead>Enter the room code and you’ll land in the lobby.</SubtleLead>

        <div className="mt-6 space-y-2">
          <label className="text-xs font-semibold tracking-wide text-white/70">ROOM CODE</label>
          <GlowInput
            value={normalizedCode}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            placeholder="ABCDE"
            className="tracking-[0.35em] uppercase"
            inputMode="text"
            autoComplete="one-time-code"
            onKeyDown={(e) => {
              if (e.key === 'Enter') join();
            }}
          />
          <div className="flex items-center justify-between text-[11px] text-white/45">
            <span>{codeOk ? 'Ready.' : 'Enter at least 4 characters.'}</span>
            <span className="tabular-nums">{normalizedCode.length}/5</span>
          </div>

          {!name && (
            <p className="mt-2 text-xs text-rose-300/90">
              Missing name. Go back and enter a display name.
            </p>
          )}
        </div>

        <div className="mt-6 grid gap-3">
          <ShimmerButton disabled={!name || !codeOk} onClick={join}>
            Join →
          </ShimmerButton>

          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-white/80 transition hover:bg-white/6"
            onClick={() => router.push('/')}
          >
            <ArrowLeft size={16} className="text-white/70" />
            Back
          </button>
        </div>
      </GlowCard>
    </EntryShell>
  );
}
