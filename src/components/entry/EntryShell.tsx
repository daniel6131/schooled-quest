import EntryBackground from '@/components/visual/EntryBackground';
import type { ReactNode } from 'react';

export function EntryShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="relative" style={{ minHeight: 'calc(var(--sq-vh) * 100)' }}>
      <EntryBackground />

      <div
        className="relative z-10 mx-auto flex w-full max-w-140 flex-col justify-center px-5 sm:px-6"
        style={{
          minHeight: 'calc(var(--sq-vh) * 100)',
          paddingTop: 'max(24px, env(safe-area-inset-top))',
          paddingBottom: 'max(24px, env(safe-area-inset-bottom))',
        }}
      >
        {children}

        {footer ? (
          <div className="mt-6 text-center">{footer}</div>
        ) : (
          <div className="mt-6 text-center text-[11px] text-white/35">
            Tip: best experience on the same Wi-Fi.
          </div>
        )}
      </div>
    </main>
  );
}
