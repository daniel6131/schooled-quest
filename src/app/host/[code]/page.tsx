import { Suspense } from 'react';
import HostRoomClient from './HostRoomClient';

type Params = Promise<{ code: string }>;

export default async function HostRoomPage({ params }: { params: Params }) {
  const { code } = await params;
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-sm text-neutral-600">Loading host dashboard…</p>
        </main>
      }
    >
      <HostRoomClient code={code} />
    </Suspense>
  );
}
