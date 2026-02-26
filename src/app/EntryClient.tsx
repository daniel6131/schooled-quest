'use client';

import { EntryShell } from '@/components/entry/EntryShell';
import {
  CTAButton,
  FeaturePill,
  GlowCard,
  GradientTitle,
  HintText,
  InputLabel,
  LogoMark,
  ModeToggle,
  NeonInput,
  SubtleLead,
} from '@/components/entry/primitives';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';

/* ─── LocalStorage helper ─── */
const LS_NAME = 'sq_name_last';
const LOCAL_STORAGE_EVENT = 'sq:localstorage';

function cleanCode(raw: string) {
  return raw
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 5);
}

function setLocalStorageString(key: string, value: string) {
  localStorage.setItem(key, value);
  window.dispatchEvent(new Event(LOCAL_STORAGE_EVENT));
}

function useLocalStorageString(key: string, fallback = '') {
  return useSyncExternalStore(
    (cb) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener('storage', cb);
      window.addEventListener(LOCAL_STORAGE_EVENT, cb);
      return () => {
        window.removeEventListener('storage', cb);
        window.removeEventListener(LOCAL_STORAGE_EVENT, cb);
      };
    },
    () => (typeof window === 'undefined' ? fallback : (localStorage.getItem(key) ?? fallback)),
    () => fallback
  );
}

/* ─── Arrow Icon ─── */
function ArrowRight() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/* ════════════════════════════════════════════════════════════════════
   ENTRY CLIENT
   ════════════════════════════════════════════════════════════════════ */
export default function EntryClient() {
  const router = useRouter();
  const name = useLocalStorageString(LS_NAME, '');
  const [mode, setMode] = useState<'join' | 'host'>('join');
  const [code, setCode] = useState('');

  const trimmedName = name.trim();
  const safeNameOk = trimmedName.length >= 2 && trimmedName.length <= 18;
  const normalizedCode = useMemo(() => cleanCode(code), [code]);
  const codeOk = normalizedCode.length >= 4;

  const canGo = safeNameOk && (mode === 'host' || codeOk);

  const go = useCallback(() => {
    if (!canGo) return;
    if (mode === 'host') {
      router.push(`/host?name=${encodeURIComponent(trimmedName)}`);
    } else {
      router.push(`/play/${normalizedCode}?name=${encodeURIComponent(trimmedName)}`);
    }
  }, [canGo, mode, trimmedName, normalizedCode, router]);

  return (
    <EntryShell>
      <div className="w-full">
        {/* ── Feature Pills ── */}
        <div
          className="animate-fade-in-up stagger-1 mb-8 flex flex-wrap items-center justify-center gap-2"
          style={{ opacity: 0 }}
        >
          <FeaturePill color="cyan">LAN-friendly</FeaturePill>
          <FeaturePill color="violet">Party-ready</FeaturePill>
          <FeaturePill color="pink">Power-ups</FeaturePill>
          <FeaturePill color="gold">Boss fights</FeaturePill>
        </div>

        {/* ── Main Card ── */}
        <div className="animate-fade-in-scale stagger-2" style={{ opacity: 0 }}>
          <GlowCard>
            <div className="flex flex-col gap-7">
              {/* Header */}
              <div className="flex flex-col items-center text-center">
                <div className="animate-fade-in-up stagger-3 mb-4" style={{ opacity: 0 }}>
                  <LogoMark size={56} />
                </div>

                <div className="animate-fade-in-up stagger-4" style={{ opacity: 0 }}>
                  <GradientTitle>Schooled Quest</GradientTitle>
                  <SubtleLead>Pick a name, then host a lobby or join with a room code.</SubtleLead>
                </div>
              </div>

              {/* ── Name ── */}
              <div className="animate-fade-in-up stagger-5" style={{ opacity: 0 }}>
                <InputLabel>Display Name</InputLabel>
                <NeonInput
                  value={name}
                  onChange={(e) => {
                    const v = e.target.value.slice(0, 18);
                    if (typeof window !== 'undefined') setLocalStorageString(LS_NAME, v);
                  }}
                  placeholder="e.g. PixelWizard"
                  autoComplete="nickname"
                  inputMode="text"
                />
                <HintText className="mt-2">
                  {safeNameOk ? (
                    <span style={{ color: 'rgba(167,139,250,0.7)' }}>✓ Looks good</span>
                  ) : (
                    '2–18 characters'
                  )}
                </HintText>
              </div>

              {/* ── Mode Toggle ── */}
              <div className="animate-fade-in-up stagger-6" style={{ opacity: 0 }}>
                <ModeToggle value={mode} onChangeAction={setMode} />
              </div>

              {/* ── Room Code (join only) ── */}
              {mode === 'join' && (
                <div className="animate-fade-in-up" style={{ animationDuration: '0.5s' }}>
                  <InputLabel>Room Code</InputLabel>
                  <NeonInput
                    value={normalizedCode}
                    onChange={(e) => setCode(cleanCode(e.target.value))}
                    placeholder="ABCDE"
                    className="text-center tracking-[0.3em] uppercase"
                    style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 600 }}
                    inputMode="text"
                    autoComplete="one-time-code"
                    maxLength={5}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') go();
                    }}
                  />
                  <div className="mt-2 flex items-center justify-between">
                    <HintText>
                      {codeOk ? (
                        <span style={{ color: 'rgba(6,182,212,0.7)' }}>✓ Ready</span>
                      ) : (
                        'At least 4 characters'
                      )}
                    </HintText>
                    <HintText>
                      <span className="tabular-nums">{normalizedCode.length}/5</span>
                    </HintText>
                  </div>
                </div>
              )}

              {/* ── CTA ── */}
              <div className="animate-fade-in-up stagger-7" style={{ opacity: 0 }}>
                <CTAButton onClick={go} disabled={!canGo}>
                  {mode === 'host' ? 'Create Lobby' : 'Join Lobby'}
                  <ArrowRight />
                </CTAButton>
              </div>
            </div>
          </GlowCard>
        </div>

        {/* ── Footer hint ── */}
        <div className="animate-fade-in-up stagger-8 mt-6 text-center" style={{ opacity: 0 }}>
          <HintText>
            <span className="hidden sm:inline">
              Press{' '}
              <kbd
                className="inline-block rounded-md px-1.5 py-0.5 text-[10px]"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  fontFamily: 'var(--font-body)',
                }}
              >
                Enter ↵
              </kbd>{' '}
              to continue
            </span>
            <span className="sm:hidden">Works great on mobile</span>
          </HintText>
        </div>
      </div>
    </EntryShell>
  );
}
