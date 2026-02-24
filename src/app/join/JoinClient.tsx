'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function JoinClient() {
  const router = useRouter();
  const params = useSearchParams();
  const name = (params.get('name') || '').trim();
  const [code, setCode] = useState('');

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border p-6">
        <h1 className="text-xl font-bold">Join a room</h1>

        <div className="space-y-2">
          <label className="text-sm font-medium">Room code</label>
          <input
            className="w-full rounded-xl border px-3 py-2 tracking-widest uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCDE"
          />
        </div>

        <button
          className="w-full rounded-xl bg-black py-2 font-medium text-white disabled:opacity-50"
          disabled={!name || code.length < 4}
          onClick={() => router.push(`/play/${code}?name=${encodeURIComponent(name)}`)}
        >
          Join
        </button>

        {!name && (
          <p className="text-sm text-red-600">Missing name. Go back and enter your name.</p>
        )}
      </div>
    </main>
  );
}
