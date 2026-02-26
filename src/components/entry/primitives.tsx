'use client';

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

/* ─── Logo Mark (inline SVG) ─── */
export function LogoMark({ size = 48 }: { size?: number }) {
  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className="animate-spin-slow absolute inset-0 rounded-full opacity-50"
        style={{
          background: 'conic-gradient(from 0deg, #7c3aed, #ec4899, #06b6d4, #f59e0b, #7c3aed)',
          filter: 'blur(8px)',
        }}
      />
      <div
        className="relative flex items-center justify-center rounded-full"
        style={{
          width: size - 4,
          height: size - 4,
          background: 'linear-gradient(135deg, #0a0a1e 0%, #12122a 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1)',
        }}
      >
        <svg
          width={size * 0.5}
          height={size * 0.5}
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"
            fill="url(#logoGrad)"
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="0.5"
          />
          <defs>
            <linearGradient id="logoGrad" x1="2" y1="2" x2="22" y2="22">
              <stop offset="0%" stopColor="#a78bfa" />
              <stop offset="50%" stopColor="#ec4899" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </div>
  );
}

/* ─── Glass Card (with animated border beam) ─── */
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

/* ─── Gradient Title ─── */
export function GradientTitle({ children }: { children: ReactNode }) {
  return (
    <h1
      style={{ fontFamily: 'var(--font-display)' }}
      className="text-[28px] leading-tight font-extrabold tracking-tight sm:text-[34px]"
    >
      <span
        className="bg-clip-text text-transparent"
        style={{
          backgroundImage:
            'linear-gradient(135deg, #ffffff 0%, #e0e0ff 40%, #a78bfa 70%, #c084fc 100%)',
        }}
      >
        {children}
      </span>
    </h1>
  );
}

/* ─── Subtitle ─── */
export function SubtleLead({ children }: { children: ReactNode }) {
  return (
    <p
      className="mt-3 text-[14px] leading-relaxed text-pretty sm:text-[15px]"
      style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'var(--font-body)' }}
    >
      {children}
    </p>
  );
}

/* ─── Input Label ─── */
export function InputLabel({ children }: { children: ReactNode }) {
  return (
    <label
      className="mb-2 block text-[11px] font-semibold tracking-[0.12em] uppercase"
      style={{ color: 'rgba(255,255,255,0.4)', fontFamily: 'var(--font-display)' }}
    >
      {children}
    </label>
  );
}

/* ─── Neon Input ─── */
export function NeonInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`neon-input ${props.className ?? ''}`} />;
}

/* ─── CTA Button ─── */
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

/* ─── Mode Toggle (compact pill style — mobile-first) ─── */
export function ModeToggle({
  value,
  onChangeAction,
}: {
  value: 'join' | 'host';
  onChangeAction: (v: 'join' | 'host') => void;
}) {
  const isJoin = value === 'join';

  return (
    <div
      style={{
        position: 'relative',
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        borderRadius: 14,
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
        padding: 3,
      }}
    >
      {/* Sliding thumb */}
      <div
        style={{
          position: 'absolute',
          top: 3,
          bottom: 3,
          left: 3,
          width: 'calc(50% - 3px)',
          borderRadius: 11,
          background: isJoin
            ? 'linear-gradient(135deg, rgba(6,182,212,0.18), rgba(124,58,237,0.12))'
            : 'linear-gradient(135deg, rgba(236,72,153,0.18), rgba(124,58,237,0.12))',
          border: `1px solid ${isJoin ? 'rgba(6,182,212,0.25)' : 'rgba(236,72,153,0.25)'}`,
          boxShadow: isJoin ? '0 4px 16px rgba(6,182,212,0.1)' : '0 4px 16px rgba(236,72,153,0.1)',
          transform: isJoin ? 'translateX(0)' : 'translateX(calc(100% + 3px))',
          transition:
            'transform 0.35s cubic-bezier(0.16,1,0.3,1), background 0.35s, border-color 0.35s, box-shadow 0.35s',
          pointerEvents: 'none',
        }}
      />

      {/* Join button */}
      <button
        type="button"
        onClick={() => onChangeAction('join')}
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '14px 8px',
          borderRadius: 11,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'white',
          transition: 'opacity 0.3s',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={isJoin ? '#22d3ee' : 'rgba(255,255,255,0.35)'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: 'stroke 0.3s', flexShrink: 0 }}
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.02em',
            opacity: isJoin ? 1 : 0.45,
            transition: 'opacity 0.3s',
          }}
        >
          Join
        </span>
      </button>

      {/* Host button */}
      <button
        type="button"
        onClick={() => onChangeAction('host')}
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '14px 8px',
          borderRadius: 11,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'white',
          transition: 'opacity 0.3s',
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={!isJoin ? '#f472b6' : 'rgba(255,255,255,0.35)'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ transition: 'stroke 0.3s', flexShrink: 0 }}
        >
          <path d="M12 2l2.4 7.4h7.6l-6 4.6 2.3 7-6.3-4.6-6.3 4.6 2.3-7-6-4.6h7.6z" />
        </svg>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.02em',
            opacity: !isJoin ? 1 : 0.45,
            transition: 'opacity 0.3s',
          }}
        >
          Host
        </span>
      </button>
    </div>
  );
}

/* ─── Feature Pill ─── */
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
        color: 'rgba(255,255,255,0.7)',
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

/* ─── Hint Text ─── */
export function HintText({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`text-[11px] ${className}`}
      style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-body)' }}
    >
      {children}
    </div>
  );
}

/* ─── Backward-compatible aliases ─── */
export const GlowInput = NeonInput;
export const ShimmerButton = CTAButton;
export const Pill = FeaturePill;
