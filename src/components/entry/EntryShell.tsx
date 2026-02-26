import EntryBackground from '@/components/visual/EntryBackground';
import type { ReactNode } from 'react';

export function EntryShell({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-svh">
      <EntryBackground />
      <div
        className="relative z-10 mx-auto flex min-h-svh w-full max-w-lg items-center justify-center px-5 sm:px-6"
        style={{
          paddingTop: 'max(32px, env(safe-area-inset-top))',
          paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
        }}
      >
        {children}
      </div>
    </main>
  );
}
