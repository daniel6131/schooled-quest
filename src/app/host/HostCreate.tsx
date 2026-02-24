'use client';

import { getSocket } from '@/lib/socket';
import type { Ack, PublicRoomState } from '@/lib/types';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const LS_HOST_KEY = 'sq_hostKey';
const LS_HOST_ROOM_CODE = 'sq_hostRoomCode';
const LOCAL_STORAGE_EVENT = 'sq:localstorage';

function setLocalStorageItem(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(LOCAL_STORAGE_EVENT));
}

export default function HostCreate() {
  const router = useRouter();
  const params = useSearchParams();
  const hostName = (params.get('name') || '').trim();
  const [error, setError] = useState<string | null>(null);
  const didCreateRef = useRef(false);

  useEffect(() => {
    if (!hostName) return;
    if (didCreateRef.current) return;
    didCreateRef.current = true;

    const s = getSocket();
    s.emit('room:create', { hostName }, (res: Ack<{ room: PublicRoomState; hostKey: string }>) => {
      if (!res.ok) return setError(res.error);
      setLocalStorageItem(LS_HOST_KEY, res.data.hostKey);
      setLocalStorageItem(LS_HOST_ROOM_CODE, res.data.room.code);
      router.replace(`/host/${res.data.room.code}?name=${encodeURIComponent(hostName)}`);
    });
  }, [hostName, router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-3 rounded-2xl border p-6">
        <h1 className="text-xl font-bold">Creating room…</h1>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && (
          <p className="text-sm text-neutral-600">Generating a code and opening the lobby.</p>
        )}
      </div>
    </main>
  );
}
