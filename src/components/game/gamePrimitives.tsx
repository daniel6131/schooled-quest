'use client';

import type { ReactNode } from 'react';

/* ════════════════════════════════════════════════════════
   GAME UI PRIMITIVES
   Shared visual components for both Host and Player screens
   ════════════════════════════════════════════════════════ */

/* ─── Timer Ring (SVG circular countdown) ─── */
export function TimerRing({
  seconds,
  fraction,
  size = 80,
  strokeWidth = 5,
  color,
  children,
}: {
  seconds: number;
  fraction: number; // 0-1 remaining
  size?: number;
  strokeWidth?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - fraction);

  const timerColor = color ?? (fraction > 0.5 ? '#7c3aed' : fraction > 0.2 ? '#f59e0b' : '#ef4444');

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="timer-ring-track"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={timerColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="timer-ring-fill"
          style={{ '--timer-color': timerColor } as React.CSSProperties}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {children ?? (
          <span
            className="tabular-nums"
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: size * 0.3,
              color: 'white',
            }}
          >
            {seconds}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Phase Chip ─── */
const PHASE_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  lobby: {
    bg: 'rgba(124,58,237,0.12)',
    border: 'rgba(124,58,237,0.25)',
    text: '#a78bfa',
    label: 'LOBBY',
  },
  wager: {
    bg: 'rgba(236,72,153,0.12)',
    border: 'rgba(236,72,153,0.25)',
    text: '#f472b6',
    label: 'HIGH STAKES',
  },
  countdown: {
    bg: 'rgba(59,130,246,0.12)',
    border: 'rgba(59,130,246,0.25)',
    text: '#60a5fa',
    label: 'GET READY',
  },
  question: {
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.25)',
    text: '#fbbf24',
    label: 'QUESTION',
  },
  reveal: {
    bg: 'rgba(34,197,94,0.12)',
    border: 'rgba(34,197,94,0.25)',
    text: '#4ade80',
    label: 'REVEAL',
  },
  shop: {
    bg: 'rgba(168,85,247,0.12)',
    border: 'rgba(168,85,247,0.25)',
    text: '#c084fc',
    label: 'SHOP',
  },
  boss: {
    bg: 'rgba(239,68,68,0.12)',
    border: 'rgba(239,68,68,0.25)',
    text: '#f87171',
    label: 'BOSS FIGHT',
  },
  intermission: {
    bg: 'rgba(6,182,212,0.12)',
    border: 'rgba(6,182,212,0.25)',
    text: '#22d3ee',
    label: 'INTERMISSION',
  },
  ended: {
    bg: 'rgba(245,158,11,0.12)',
    border: 'rgba(245,158,11,0.25)',
    text: '#fbbf24',
    label: 'GAME OVER',
  },
};

export function PhaseChip({ phase }: { phase: string }) {
  const s = PHASE_STYLES[phase] ?? PHASE_STYLES.lobby;
  return (
    <span
      className="phase-badge"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: s.text,
          boxShadow: `0 0 8px ${s.text}`,
        }}
      />
      {s.label}
    </span>
  );
}

/* ─── Stat Bar (lives / score / coins) ─── */
export function StatBar({
  lives,
  maxLives,
  score,
  coins,
  eliminated,
}: {
  lives: number;
  maxLives: number;
  score: number;
  coins: number;
  eliminated?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="stat-pill stat-pill-lives">
        {Array.from({ length: maxLives }).map((_, i) => (
          <span key={i} style={{ opacity: i < lives ? 1 : 0.2, fontSize: 14 }}>
            ♥
          </span>
        ))}
      </span>
      <span className="stat-pill stat-pill-score">
        <span style={{ color: '#fbbf24', fontSize: 12 }}>★</span>
        <span className="tabular-nums">{score}</span>
      </span>
      <span className="stat-pill stat-pill-coins">
        <span style={{ fontSize: 12 }}>🪙</span>
        <span className="tabular-nums">{coins}</span>
      </span>
      {eliminated && (
        <span
          className="stat-pill"
          style={{
            background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.25)',
            color: '#f87171',
          }}
        >
          💀 OUT
        </span>
      )}
    </div>
  );
}

/* ─── Act Banner ─── */
const ACT_COLORS: Record<string, { gradient: string; glow: string }> = {
  homeroom: { gradient: 'linear-gradient(135deg, #059669, #10b981)', glow: 'rgba(16,185,129,0.2)' },
  pop_quiz: { gradient: 'linear-gradient(135deg, #d97706, #f59e0b)', glow: 'rgba(245,158,11,0.2)' },
  field_trip: {
    gradient: 'linear-gradient(135deg, #ea580c, #f97316)',
    glow: 'rgba(249,115,22,0.2)',
  },
  wager_round: {
    gradient: 'linear-gradient(135deg, #db2777, #ec4899)',
    glow: 'rgba(236,72,153,0.2)',
  },
  boss_fight: {
    gradient: 'linear-gradient(135deg, #dc2626, #ef4444)',
    glow: 'rgba(239,68,68,0.2)',
  },
};

export function ActBanner({
  actId,
  name,
  emoji,
  description,
  heartsAtRisk,
  questionNumber,
  totalQuestions,
}: {
  actId: string;
  name: string;
  emoji: string;
  description: string;
  heartsAtRisk: boolean;
  questionNumber: number;
  totalQuestions: number;
}) {
  const c = ACT_COLORS[actId] ?? ACT_COLORS.homeroom;
  return (
    <div
      className="game-card-compact"
      style={{ borderColor: heartsAtRisk ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)' }}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg"
            style={{ background: c.gradient, boxShadow: `0 4px 12px ${c.glow}` }}
          >
            {emoji}
          </span>
          <div className="min-w-0">
            <div
              className="truncate text-sm font-bold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {name}
            </div>
            <div className="truncate text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {description}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{
              background: heartsAtRisk ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
              color: heartsAtRisk ? '#f87171' : '#4ade80',
            }}
          >
            {heartsAtRisk ? '♥ AT RISK' : '🛡 SAFE'}
          </span>
          <span className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Q{questionNumber}/{totalQuestions}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ─── Boss HP Bar ─── */
export function BossBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const pct = Math.max(0, (hp / maxHp) * 100);
  return (
    <div className="game-card-compact p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🐉</span>
          <span
            className="text-sm font-bold text-white"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Boss Fight
          </span>
        </div>
        <span className="text-sm font-bold tabular-nums" style={{ color: '#f87171' }}>
          {hp}/{maxHp}
        </span>
      </div>
      <div className="boss-bar-track">
        <div className="boss-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ─── Wager Tier Badge ─── */
const TIER_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  SAFE: { bg: 'rgba(255,255,255,0.06)', text: 'rgba(255,255,255,0.5)', label: '🙂 SAFE' },
  BOLD: { bg: 'rgba(59,130,246,0.12)', text: '#60a5fa', label: '💪 BOLD' },
  HIGH_ROLLER: { bg: 'rgba(245,158,11,0.12)', text: '#fbbf24', label: '🎲 HIGH ROLLER' },
  INSANE: { bg: 'rgba(168,85,247,0.12)', text: '#c084fc', label: '😈 INSANE' },
  ALL_IN: { bg: 'rgba(239,68,68,0.15)', text: '#f87171', label: '🟥 ALL IN' },
};

export function WagerTierBadge({ tier }: { tier: string }) {
  const s = TIER_STYLES[tier] ?? TIER_STYLES.SAFE;
  return (
    <span
      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold"
      style={{ background: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}

/* ─── Player Row ─── */
export function PlayerRow({
  name,
  lives,
  score,
  coins,
  connected,
  eliminated,
  isMe,
  lockedIn,
  buffs,
  hasBuyback,
}: {
  name: string;
  lives: number;
  score: number;
  coins: number;
  connected: boolean;
  eliminated: boolean;
  isMe?: boolean;
  lockedIn?: boolean;
  buffs?: { doublePoints?: boolean; shield?: boolean };
  hasBuyback?: boolean;
}) {
  return (
    <div
      className="game-card-compact flex items-center justify-between gap-3 px-4 py-3"
      style={{
        opacity: eliminated ? 0.4 : 1,
        borderColor: isMe ? 'rgba(124,58,237,0.2)' : undefined,
        background: isMe ? 'rgba(124,58,237,0.06)' : undefined,
      }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex h-2 w-2 shrink-0 rounded-full"
          style={{
            background: connected ? '#4ade80' : '#ef4444',
            boxShadow: connected ? '0 0 8px rgba(74,222,128,0.5)' : 'none',
          }}
        />
        <span className="truncate text-sm font-semibold text-white">
          {name}
          {isMe && <span style={{ color: 'rgba(255,255,255,0.35)', marginLeft: 4 }}>(you)</span>}
        </span>
        {eliminated && <span className="text-xs">💀</span>}
        {lockedIn && !eliminated && (
          <span className="text-[10px]" style={{ color: '#4ade80' }}>
            🔒
          </span>
        )}
        {buffs?.doublePoints && (
          <span className="text-[10px]" title="Double Points">
            ⭐
          </span>
        )}
        {buffs?.shield && (
          <span className="text-[10px]" title="Shield">
            🛡️
          </span>
        )}
        {hasBuyback && (
          <span className="text-[10px]" title="Buyback">
            🪙
          </span>
        )}
      </div>
      <div
        className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums"
        style={{ color: 'rgba(255,255,255,0.5)' }}
      >
        <span style={{ color: '#f87171' }}>♥{lives}</span>
        <span style={{ color: '#fbbf24' }}>★{score}</span>
        <span style={{ color: '#c084fc' }}>🪙{coins}</span>
      </div>
    </div>
  );
}

/* ─── Buff Indicators ─── */
export function BuffIndicators({
  doublePoints,
  shield,
  buybackToken,
}: {
  doublePoints?: boolean;
  shield?: boolean;
  buybackToken?: boolean;
}) {
  if (!doublePoints && !shield && !buybackToken) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {doublePoints && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
          style={{
            background: 'rgba(245,158,11,0.1)',
            border: '1px solid rgba(245,158,11,0.2)',
            color: '#fbbf24',
          }}
        >
          ⭐ Double Points
        </span>
      )}
      {shield && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
          style={{
            background: 'rgba(59,130,246,0.1)',
            border: '1px solid rgba(59,130,246,0.2)',
            color: '#60a5fa',
          }}
        >
          🛡️ Shield
        </span>
      )}
      {buybackToken && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
          style={{
            background: 'rgba(34,197,94,0.1)',
            border: '1px solid rgba(34,197,94,0.2)',
            color: '#4ade80',
          }}
        >
          🪙 Buyback Ready
        </span>
      )}
    </div>
  );
}

/* ─── Game Section Header ─── */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="text-[10px] font-bold tracking-[0.12em] uppercase"
      style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-display)' }}
    >
      {children}
    </div>
  );
}

/* ─── Wager Stage Dots ─── */
export function WagerStages({ currentIndex }: { currentIndex: number }) {
  const stages = ['???', 'Category', 'Hint', 'REDLINE', 'Closing'];
  return (
    <div className="flex flex-wrap gap-1.5">
      {stages.map((label, i) => {
        const done = currentIndex >= i;
        const isRedline = i === 3;
        return (
          <span
            key={label}
            className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
            style={{
              background: done
                ? isRedline
                  ? 'rgba(239,68,68,0.15)'
                  : 'rgba(236,72,153,0.12)'
                : 'rgba(255,255,255,0.04)',
              color: done ? (isRedline ? '#f87171' : '#f472b6') : 'rgba(255,255,255,0.25)',
              border: `1px solid ${
                done
                  ? isRedline
                    ? 'rgba(239,68,68,0.25)'
                    : 'rgba(236,72,153,0.2)'
                  : 'rgba(255,255,255,0.06)'
              }`,
            }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}
