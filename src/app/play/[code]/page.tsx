import { Suspense } from 'react';
import PlayRoomClient from './PlayRoomClient';

type Params = Promise<{ code: string }>;

export default async function PlayRoomPage({ params }: { params: Params }) {
  const { code } = await params;
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center p-6">
          <p className="text-sm text-neutral-600">Loading…</p>
        </main>
      }
    >
      <PlayRoomClient code={code} />
    </Suspense>
  );
}
