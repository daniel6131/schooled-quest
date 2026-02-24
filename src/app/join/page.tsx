import { Suspense } from 'react';
import JoinClient from './JoinClient';

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-md space-y-4 rounded-2xl border p-6">
            <h1 className="text-xl font-bold">Join a room</h1>
            <p className="text-sm text-neutral-600">Loading…</p>
          </div>
        </main>
      }
    >
      <JoinClient />
    </Suspense>
  );
}
