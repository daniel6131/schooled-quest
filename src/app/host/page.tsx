import { Suspense } from 'react';
import HostCreate from './HostCreate';

export default function HostPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-md space-y-3 rounded-2xl border p-6">
            <h1 className="text-xl font-bold">Creating room…</h1>
            <p className="text-sm text-neutral-600">Loading…</p>
          </div>
        </main>
      }
    >
      <HostCreate />
    </Suspense>
  );
}
