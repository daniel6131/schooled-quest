'use client';

import { EntryShell } from '@/components/entry/EntryShell';
import { GlowCard, GradientTitle, ShimmerButton, SubtleLead } from '@/components/entry/primitives';
import { getSocket } from '@/lib/socket';
import type { Ack, PublicRoomState } from '@/lib/types';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const LS_NAME = 'sq_name_last';
const LS_HOST_KEY = 'sq_hostKey';
const LS_HOST_ROOM_CODE = 'sq_hostRoomCode';
const LOCAL_STORAGE_EVENT = 'sq:localstorage';

function setLocalStorageString(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(LOCAL_STORAGE_EVENT));
}

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

export default function HostCreate() {
  const router = useRouter();
  const params = useSearchParams();

  const savedName = useLocalStorageString(LS_NAME, '');

  // Prefer query param name, fallback to saved name
  const hostName = (params.get('name') || savedName).trim();

  const [error, setError] = useState<string | null>(null);
  const didCreateRef = useRef(false);

  useEffect(() => {
    if (!hostName) return;
    if (didCreateRef.current) return;
    didCreateRef.current = true;

    const s = getSocket();

    s.emit('room:create', { hostName }, (res: Ack<{ room: PublicRoomState; hostKey: string }>) => {
      if (!res.ok) {
        setError(res.error);
        didCreateRef.current = false;
        return;
      }

      setLocalStorageString(LS_HOST_KEY, res.data.hostKey);
      setLocalStorageString(LS_HOST_ROOM_CODE, res.data.room.code);

      router.replace(`/host/${res.data.room.code}?name=${encodeURIComponent(hostName)}`);
    });
  }, [hostName, router]);

  return (
    <EntryShell>
      <GlowCard>
        <GradientTitle>Creating lobby…</GradientTitle>
        <SubtleLead>Generating a room code and opening the host dashboard.</SubtleLead>

        <div className="mt-6">
          {!hostName ? (
            <div className="space-y-4">
              <p className="text-sm text-white/70">
                Missing name. Go back and enter a display name.
              </p>
              <ShimmerButton onClick={() => router.push('/')}>
                <span className="inline-flex items-center gap-2">
                  <ArrowLeft size={16} />
                  Back to start
                </span>
              </ShimmerButton>
            </div>
          ) : error ? (
            <div className="space-y-4">
              <p className="text-sm text-rose-300/90">{error}</p>
              <ShimmerButton
                onClick={() => {
                  setError(null);
                  didCreateRef.current = false;
                  router.refresh();
                }}
              >
                Try again →
              </ShimmerButton>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm text-white/70">
              <Loader2 className="animate-spin" size={18} />
              Talking to the server…
            </div>
          )}
        </div>
      </GlowCard>
    </EntryShell>
  );
}
