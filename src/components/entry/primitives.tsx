'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/* ─────────────────────────────────────────────────────────────
   Brand / Logo
───────────────────────────────────────────────────────────── */
export function LogoMark({ size = 52 }: { size?: number }) {
  const inner = Math.max(28, size - 6);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className="animate-spin-slow absolute inset-0 rounded-full opacity-60 blur-[10px]"
        style={{
          background: 'conic-gradient(from 0deg, #7c3aed, #ec4899, #06b6d4, #f59e0b, #7c3aed)',
        }}
      />
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: inner,
          height: inner,
          background: 'linear-gradient(135deg, rgba(10,10,30,0.95) 0%, rgba(14,14,40,0.9) 100%)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 14px 50px rgba(0,0,0,0.55)',
        }}
      >
        <svg width={inner * 0.52} height={inner * 0.52} viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M12 2L15.1 8.26L22 9.27L17 14.14L18.2 21.02L12 17.77L5.8 21.02L7 14.14L2 9.27L8.9 8.26L12 2Z"
            fill="url(#sqGrad)"
            stroke="rgba(255,255,255,0.18)"
            strokeWidth="0.6"
          />
          <defs>
            <linearGradient id="sqGrad" x1="2" y1="2" x2="22" y2="22">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="45%" stopColor="#a78bfa" />
              <stop offset="75%" stopColor="#ec4899" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Layout pieces
───────────────────────────────────────────────────────────── */
export function GlowCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass-card ${className}`}>
      <div className="pointer-events-none absolute top-0 right-0 left-0 h-px bg-linear-to-r from-transparent via-white/10 to-transparent" />
      <div className="relative z-10 p-6 sm:p-8">{children}</div>
    </div>
  );
}

export function GradientTitle({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{ fontFamily: 'var(--font-display)' }}
      className="text-[28px] leading-[1.08] font-extrabold tracking-tight sm:text-[36px]"
    >
      <span
        className="bg-clip-text text-transparent"
        style={{
          backgroundImage:
            'linear-gradient(135deg, #ffffff 0%, #e9e7ff 35%, #a78bfa 70%, #c084fc 100%)',
        }}
      >
        {children}
      </span>
    </h1>
  );
}

export function SubtleLead({ children }: { children: ReactNode }) {
  return (
    <p
      className="mt-3 text-[14px] leading-relaxed text-pretty sm:text-[15px]"
      style={{ color: 'rgba(255,255,255,0.55)', fontFamily: 'var(--font-body)' }}
    >
      {children}
    </p>
  );
}

export function HintText({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`text-[11px] ${className}`} style={{ color: 'rgba(255,255,255,0.35)' }}>
      {children}
    </div>
  );
}

export function InputLabel({ children }: { children: ReactNode }) {
  return (
    <label
      className="mb-2 block text-[11px] font-semibold tracking-[0.12em] uppercase"
      style={{ color: 'rgba(255,255,255,0.42)', fontFamily: 'var(--font-display)' }}
    >
      {children}
    </label>
  );
}

/* ─────────────────────────────────────────────────────────────
   Inputs / Buttons
───────────────────────────────────────────────────────────── */
export function NeonInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`neon-input ${props.className ?? ''}`} />;
}

export function CTAButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className={`cta-button ${className}`}>
      <span className="relative z-10 flex items-center justify-center gap-2">{children}</span>
    </button>
  );
}

export function GhostButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-sm text-white/80 transition hover:bg-white/6 active:scale-[0.99] ${className}`}
    >
      {children}
    </button>
  );
}

/* ─────────────────────────────────────────────────────────────
   Feature pills
───────────────────────────────────────────────────────────── */
export function FeaturePill({
  children,
  color = 'violet',
}: {
  children: ReactNode;
  color?: 'violet' | 'pink' | 'cyan' | 'gold';
}) {
  const colors = {
    violet: { bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)', dot: '#a78bfa' },
    pink: { bg: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.2)', dot: '#f472b6' },
    cyan: { bg: 'rgba(6,182,212,0.08)', border: 'rgba(6,182,212,0.2)', dot: '#22d3ee' },
    gold: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', dot: '#fbbf24' },
  };
  const c = colors[color];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium"
      style={{
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: 'rgba(255,255,255,0.72)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: c.dot, boxShadow: `0 0 6px ${c.dot}` }}
      />
      {children}
    </span>
  );
}

/* ─────────────────────────────────────────────────────────────
   Backward-compatible aliases (so other files don’t break)
───────────────────────────────────────────────────────────── */
export const GlowInput = NeonInput;
export const ShimmerButton = CTAButton;
export const Pill = FeaturePill;

/**
 * Kept for compatibility if any older entry code still imports it.
 * You can keep using it if you want, but the new EntryClient uses
 * separate pages instead.
 */
export function ModeToggle({
  value,
  onChangeAction,
}: {
  value: 'join' | 'host';
  onChangeAction: (v: 'join' | 'host') => void;
}) {
  const isJoin = value === 'join';
  return (
    <div className="mode-toggle">
      <div className="mode-toggle-thumb" data-active={isJoin ? 'join' : 'host'} />
      <button className="mode-toggle-btn" type="button" onClick={() => onChangeAction('join')}>
        Join
      </button>
      <button className="mode-toggle-btn" type="button" onClick={() => onChangeAction('host')}>
        Host
      </button>
    </div>
  );
}
