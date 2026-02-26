import { Suspense } from 'react';
import JoinClient from './JoinClient';

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-sm text-white/60">Opening join portal…</p>
        </main>
      }
    >
      <JoinClient />
    </Suspense>
  );
}
