import { Suspense } from 'react';
import HostCreate from './HostCreate';

export default function HostPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-sm text-white/60">Preparing host tools…</p>
        </main>
      }
    >
      <HostCreate />
    </Suspense>
  );
}
