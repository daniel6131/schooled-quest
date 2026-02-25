'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState('');

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-2xl border p-6">
        <h1 className="text-2xl font-bold">Schooled: Quest Mode</h1>
        <p className="text-sm text-neutral-600">Day 1: live lobby + room codes.</p>

        <div className="space-y-2">
          <label className="text-sm font-medium">Your name</label>
          <input
            className="w-full rounded-xl border px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Sam"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            className="rounded-xl bg-black py-2 font-medium text-white disabled:opacity-50"
            disabled={!name.trim()}
            onClick={() => router.push(`/host?name=${encodeURIComponent(name.trim())}`)}
          >
            Host
          </button>
          <button
            className="rounded-xl border py-2 font-medium disabled:opacity-50"
            disabled={!name.trim()}
            onClick={() => router.push(`/join?name=${encodeURIComponent(name.trim())}`)}
          >
            Join
          </button>
        </div>
      </div>
    </main>
  );
}
