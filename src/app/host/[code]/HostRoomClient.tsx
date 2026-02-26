'use client';

import {
  ActBanner,
  BossBar,
  PhaseChip,
  PlayerRow,
  TimerRing,
  WagerStages,
  WagerTierBadge,
} from '@/components/game/gamePrimitives';
import { logger } from '@/lib/logger';
import { getSocket } from '@/lib/socket';
import type { Ack, HostRoomState, PublicRoomState, WagerSpotlightPayload } from '@/lib/types';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

const LS_HOST_KEY = 'sq_hostKey';
const LOCAL_STORAGE_EVENT = 'sq:localstorage';

type ActId = 'homeroom' | 'pop_quiz' | 'field_trip' | 'wager_round' | 'boss_fight';

const ACT_META: Record<ActId, { name: string; emoji: string; color: string }> = {
  homeroom: { name: 'Homeroom', emoji: '🏫', color: 'green' },
  pop_quiz: { name: 'Pop Quiz', emoji: '📝', color: 'amber' },
  field_trip: { name: 'Field Trip', emoji: '🎒', color: 'orange' },
  wager_round: { name: 'High Stakes', emoji: '🎰', color: 'pink' },
  boss_fight: { name: 'Boss Fight', emoji: '🐉', color: 'red' },
};

const ACT_BTN_CLS: Record<string, string> = {
  homeroom: 'host-btn-green',
  pop_quiz: 'host-btn-amber',
  field_trip: 'host-btn-amber',
  wager_round: 'host-btn-pink',
  boss_fight: 'host-btn-red',
};

function useLocalStorageItem(key: string): string | null {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => {};
      const handler = () => onStoreChange();
      window.addEventListener('storage', handler);
      window.addEventListener(LOCAL_STORAGE_EVENT, handler);
      return () => {
        window.removeEventListener('storage', handler);
        window.removeEventListener(LOCAL_STORAGE_EVENT, handler);
      };
    },
    () => (typeof window === 'undefined' ? null : localStorage.getItem(key)),
    () => null
  );
}

export default function HostRoomClient({ code }: { code: string }) {
  const params = useSearchParams();
  const hostName = (params.get('name') || '').trim();
  const roomCode = useMemo(() => (code ?? '').trim().toUpperCase(), [code]);
  const hostKey = useLocalStorageItem(LS_HOST_KEY);

  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [hostState, setHostState] = useState<HostRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState<WagerSpotlightPayload | null>(null);
  const [wagerSiren, setWagerSiren] = useState(false);
  const [showLog, setShowLog] = useState(false);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 30));
  }, []);

  const emitHost = useCallback(
    <T,>(event: string, extra: Record<string, unknown> = {}, label?: string) => {
      if (!hostKey) return addLog('❌ No hostKey');
      const s = getSocket();
      s.emit(event, { code: roomCode, hostKey, ...extra }, (ack: Ack<T>) => {
        if (!ack.ok) {
          setError((ack as { ok: false; error: string }).error);
          addLog(`❌ ${label || event}: ${(ack as { ok: false; error: string }).error}`);
        } else {
          setError(null);
          addLog(`✅ ${label || event}`);
          const data = (ack as { ok: true; data: T }).data as Record<string, unknown>;
          if (data?.room) setRoom(data.room as PublicRoomState);
        }
      });
    },
    [hostKey, roomCode, addLog]
  );

  useEffect(() => {
    const s = getSocket();
    const onRoom = (r: PublicRoomState) => setRoom(r);
    const onHost = (h: HostRoomState) => setHostState(h);
    const onWagerSpotlight = (p: WagerSpotlightPayload) => setSpotlight(p);
    const onWagerSiren = () => {
      setWagerSiren(true);
      setTimeout(() => setWagerSiren(false), 1200);
    };
    s.on('room:state', onRoom);
    s.on('host:state', onHost);
    s.on('wager:spotlight', onWagerSpotlight);
    s.on('wager:siren', onWagerSiren);
    return () => {
      s.off('room:state', onRoom);
      s.off('host:state', onHost);
      s.off('wager:spotlight', onWagerSpotlight);
      s.off('wager:siren', onWagerSiren);
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    fetch('/api/lan')
      .then((r) => r.json())
      .then((d: { url: string | null }) => setLanUrl(d.url))
      .catch(() => setLanUrl(null));
  }, []);

  useEffect(() => {
    if (!roomCode || !hostKey) return;
    const s = getSocket();
    const doResume = () => {
      s.emit(
        'room:resume',
        { code: roomCode, hostKey },
        (ack: Ack<{ room: PublicRoomState; isHost: boolean }>) => {
          if (!ack.ok) return setError(ack.error);
          setError(null);
          setRoom(ack.data.room);
          addLog('✅ Resumed into room');
        }
      );
    };
    if (s.connected) doResume();
    const onConnect = () => {
      logger.info({ roomCode }, 'socket (re)connected, resuming room');
      doResume();
    };
    s.on('connect', onConnect);
    return () => {
      s.off('connect', onConnect);
    };
  }, [roomCode, hostKey, addLog]);

  const phase = room?.phase ?? 'lobby';
  const q = room?.currentQuestion;
  const boss = room?.boss;
  const wager = room?.wager;
  const shopOpen = room?.shop?.open ?? false;
  const currentAct = room?.currentAct;
  const availableActs = hostState?.availableActs ?? [];
  const activePlayers = (room?.players ?? []).filter((p) => p.connected && !p.eliminated);
  const lockedInCount = activePlayers.filter((p) => p.lockedIn).length;
  const activeCount = activePlayers.length;
  const allLockedIn = activeCount > 0 && lockedInCount === activeCount;
  const revealAt = q?.revealAt ?? q?.endsAt ?? 0;
  const canReveal =
    !!q && (phase === 'question' || phase === 'boss') && !q.locked && now >= revealAt;
  const isCountdown = phase === 'countdown';
  const countdownEndsAt = q?.countdownEndsAt ?? 0;
  const countdownMsLeft = isCountdown ? Math.max(0, countdownEndsAt - now) : 0;
  const countdownSecondsLeft = Math.ceil(countdownMsLeft / 1000);
  const isIntermission = phase === 'intermission';
  const isWager = phase === 'wager';
  const wagerEndsAt = wager?.endsAt ?? 0;
  const wagerSecondsLeft = isWager ? Math.max(0, Math.ceil((wagerEndsAt - now) / 1000)) : 0;
  const wagerStage = wager?.stage ?? 'blind';
  const wagerStageIndex =
    wagerStage === 'blind'
      ? 0
      : wagerStage === 'category'
        ? 1
        : wagerStage === 'hint'
          ? 2
          : wagerStage === 'redline'
            ? 3
            : wagerStage === 'closing'
              ? 4
              : 5;
  const wagerNoDecreases = wager?.noDecreases ?? false;
  const pendingRevive = hostState?.pendingRevive ?? null;

  if (!roomCode) {
    return (
      <main className="relative z-10 flex min-h-dvh items-center justify-center p-6">
        <div className="game-card p-8">
          <h1 className="text-lg font-bold text-white">Invalid room</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="relative z-10 min-h-dvh pb-8">
      {/* ── Spotlight Modal ── */}
      {spotlight && phase === 'wager' && (
        <div className="game-modal-backdrop">
          <div className="game-card w-full p-6" style={{ maxWidth: 520 }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div
                  className="text-[11px] font-bold tracking-wider uppercase"
                  style={{ color: '#f472b6' }}
                >
                  🎥 Spotlight
                </div>
                <div
                  className="mt-1 text-2xl font-black text-white"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  HIGH STAKES LOCKED
                </div>
              </div>
              <div className="game-card-compact px-4 py-2 text-right">
                <div className="text-[10px] font-bold" style={{ color: '#f472b6' }}>
                  TOTAL POT
                </div>
                <div className="text-xl font-black text-white tabular-nums">
                  {spotlight.totalWagered}
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {[
                { label: 'ALL IN', val: spotlight.allInCount },
                { label: 'NO BET', val: spotlight.noBetCount },
                { label: 'BIGGEST', val: spotlight.biggest?.name ?? '—' },
              ].map((s) => (
                <div key={s.label} className="game-card-compact p-3">
                  <div className="text-[10px] font-bold" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {s.label}
                  </div>
                  <div className="mt-1 text-lg font-black text-white">{s.val}</div>
                </div>
              ))}
            </div>
            {spotlight.topRisk.length > 0 && (
              <div className="mt-4 space-y-2">
                {spotlight.topRisk.map((e, idx) => (
                  <div
                    key={e.playerId}
                    className="game-card-compact flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="text-sm font-black"
                        style={{ color: 'rgba(255,255,255,0.3)' }}
                      >
                        #{idx + 1}
                      </span>
                      <div>
                        <div className="text-sm font-bold text-white">{e.name}</div>
                        <div className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                          Bet {e.wager} ({Math.round(e.ratio * 100)}%)
                        </div>
                      </div>
                    </div>
                    <WagerTierBadge tier={e.tier} />
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className="cta-button mt-5"
              style={{
                background: 'linear-gradient(135deg, #db2777, #ec4899)',
                boxShadow: '0 0 20px rgba(236,72,153,0.3)',
              }}
              onClick={() => {
                if (!hostKey) return addLog('❌ No hostKey');
                const s = getSocket();
                s.emit(
                  'wager:spotlight_end',
                  { code: roomCode, hostKey },
                  (ack: Ack<{ room: PublicRoomState }>) => {
                    if (!ack.ok) {
                      setError((ack as { ok: false; error: string }).error);
                      return;
                    }
                    setError(null);
                    addLog('✅ Start High Stakes Question');
                    setSpotlight(null);
                    setRoom((ack as { ok: true; data: { room: PublicRoomState } }).data.room);
                  }
                );
              }}
            >
              <span className="relative z-10">▶ Start High Stakes Question</span>
            </button>
            <div
              className="mt-2 text-center text-[11px]"
              style={{ color: 'rgba(255,255,255,0.3)' }}
            >
              Stays up until you press Start
            </div>
          </div>
        </div>
      )}

      {/* ── Revive Request Modal ── */}
      {pendingRevive && (
        <div className="game-modal-backdrop">
          <div className="game-card w-full p-8 text-center" style={{ maxWidth: 420 }}>
            <div className="text-5xl">🙏</div>
            <h2
              className="mt-4 text-xl font-bold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Revive Shrine
            </h2>
            <p className="mt-2 text-base text-white">
              <span className="font-bold">{pendingRevive.playerName}</span> wants to be revived!
            </p>
            <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.45)' }}>
              Have them complete the forfeit, then decide.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => emitHost('revive:approve', {}, 'Approve Revive')}
                className="host-btn host-btn-green"
                style={{ padding: '14px' }}
              >
                ✅ Approve
              </button>
              <button
                type="button"
                onClick={() => emitHost('revive:decline', {}, 'Decline Revive')}
                className="host-btn host-btn-red"
                style={{ padding: '14px' }}
              >
                ❌ Decline
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-5xl space-y-4 px-6 pt-5">
        {/* ── Header ── */}
        <header className="game-card px-6 py-5">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <div
                className="text-[10px] font-bold tracking-wider uppercase"
                style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-display)' }}
              >
                Host Dashboard
              </div>
              <h1
                className="mt-1 truncate text-xl font-bold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {hostName ? `${hostName}'s Room` : 'Host Room'}
              </h1>
              <div
                className="mt-1 flex items-center gap-3 text-sm"
                style={{ color: 'rgba(255,255,255,0.45)' }}
              >
                <span>
                  Code: <span className="font-mono font-bold text-white">{roomCode}</span>
                </span>
                {lanUrl && (
                  <span>
                    LAN: <span className="font-mono text-[11px]">{lanUrl}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <PhaseChip phase={phase} />
              {currentAct && (
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  {currentAct.emoji} Q{currentAct.questionNumber}/{currentAct.totalQuestions}
                </span>
              )}
              <span className="text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.3)' }}>
                {room?.remainingQuestions ?? '?'} left
              </span>
            </div>
          </div>
          {error && (
            <p className="mt-3 text-xs font-medium" style={{ color: '#f87171' }}>
              {error}
            </p>
          )}
        </header>

        {/* ── Two-column layout ── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* LEFT: Game controls + question */}
          <div className="space-y-4 lg:col-span-2">
            {/* Act Banner */}
            {currentAct && (
              <ActBanner
                actId={currentAct.id}
                name={currentAct.name}
                emoji={currentAct.emoji}
                description={currentAct.description}
                heartsAtRisk={currentAct.heartsAtRisk}
                questionNumber={currentAct.questionNumber}
                totalQuestions={currentAct.totalQuestions}
              />
            )}

            {/* Game Flow Controls */}
            <div className="game-card p-5">
              <div
                className="mb-3 text-[10px] font-bold tracking-wider uppercase"
                style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-display)' }}
              >
                Game Flow
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="host-btn host-btn-green"
                  disabled={phase !== 'lobby' && phase !== 'shop' && phase !== 'reveal'}
                  onClick={() => {
                    if (phase === 'lobby') emitHost('game:start', {}, 'Start Game');
                    else emitHost('question:next', {}, 'Next Question');
                  }}
                  type="button"
                >
                  {phase === 'lobby' ? '▶ Start Game' : '⏭ Next Question'}
                </button>
                <button
                  className="host-btn host-btn-amber"
                  disabled={!canReveal}
                  onClick={() => emitHost('question:reveal', {}, 'Reveal')}
                  type="button"
                >
                  👁 Reveal
                </button>
                <button
                  className="host-btn host-btn-violet"
                  disabled={phase !== 'reveal' && phase !== 'shop' && phase !== 'intermission'}
                  onClick={() =>
                    emitHost(
                      'shop:open',
                      { open: !shopOpen },
                      shopOpen ? 'Close Shop' : 'Open Shop'
                    )
                  }
                  type="button"
                >
                  🛒 {shopOpen ? 'Close Shop' : 'Open Shop'}
                </button>
                <button
                  className="host-btn host-btn-pink"
                  disabled={!isWager || !wager?.open}
                  onClick={() => emitHost('wager:lock', {}, 'Lock Wagers')}
                  type="button"
                >
                  🎰 Lock Wagers
                </button>
                <button
                  className="host-btn host-btn-red"
                  disabled={!availableActs.includes('boss_fight') || !isIntermission}
                  onClick={() => emitHost('act:start', { actId: 'boss_fight' }, 'Start Boss')}
                  type="button"
                >
                  🐉 Boss
                </button>
              </div>

              {/* Act Transitions */}
              {isIntermission && availableActs.length > 0 && (
                <div className="game-card-compact mt-4 p-4">
                  <div className="mb-3 text-xs font-bold text-white">
                    🎬 {currentAct?.name} complete! Start next:
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableActs.map((actId) => {
                      const meta = ACT_META[actId];
                      return (
                        <button
                          key={actId}
                          type="button"
                          onClick={() => emitHost('act:start', { actId }, `Start ${meta.name}`)}
                          className={`host-btn ${ACT_BTN_CLS[actId] ?? 'host-btn-green'}`}
                        >
                          {meta.emoji} {meta.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Wager Phase */}
            {isWager && wager && (
              <div className="game-card p-5" style={{ borderColor: 'rgba(236,72,153,0.15)' }}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2
                    className="text-base font-bold text-white"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    🎰 High Stakes
                  </h2>
                  <TimerRing
                    seconds={wagerSecondsLeft}
                    fraction={wagerSecondsLeft / 30}
                    size={48}
                    strokeWidth={3}
                    color="#ec4899"
                  >
                    <span
                      className={`text-xs font-bold text-white tabular-nums ${wagerSiren ? 'siren-active' : ''}`}
                    >
                      {wagerSecondsLeft}
                    </span>
                  </TimerRing>
                </div>
                <div className="game-card-compact mb-3 p-4">
                  <div className="text-sm text-white">
                    Category:{' '}
                    <span className="font-bold" style={{ color: '#f472b6' }}>
                      {wager.category ?? '???'}
                    </span>
                  </div>
                  <div className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                    Hint: {wager.hint ?? '???'}
                  </div>
                  <div className="mt-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    Total wagered:{' '}
                    <span className="font-bold text-white">{wager.totalWagered}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <WagerStages currentIndex={wagerStageIndex} />
                  {wagerNoDecreases && (
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
                    >
                      🚨 NO DECREASES
                    </span>
                  )}
                </div>
                {!wager.open && (
                  <div
                    className="game-card-compact mt-3 p-3 text-center text-sm font-semibold"
                    style={{ color: 'rgba(255,255,255,0.5)' }}
                  >
                    🔒 Locked — Spotlight in progress
                  </div>
                )}
              </div>
            )}

            {/* Current Question */}
            {q && (
              <div className="game-card p-5" style={{ borderColor: 'rgba(245,158,11,0.1)' }}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2
                    className="text-base font-bold text-white"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {phase === 'boss'
                      ? '🐉 Boss Question'
                      : isCountdown
                        ? '⏳ Countdown'
                        : '❓ Question'}
                  </h2>
                  {q.question.hard && (
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
                    >
                      ⚠️ HARD
                    </span>
                  )}
                </div>

                {/* Timer */}
                {isCountdown ? (
                  <div className="flex items-center justify-center py-4">
                    <div
                      className="countdown-number"
                      key={countdownSecondsLeft}
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontWeight: 900,
                        fontSize: 60,
                        color: '#60a5fa',
                      }}
                    >
                      {countdownSecondsLeft || '🚀'}
                    </div>
                  </div>
                ) : (
                  <div className="game-card-compact mb-3 flex items-center justify-between px-4 py-3">
                    <div className="text-sm font-semibold text-white">
                      {q.locked ? 'Revealed' : 'Reveal in'}
                    </div>
                    <span className="text-sm font-bold text-white tabular-nums">
                      {q.locked ? '—' : `${Math.max(0, Math.ceil((revealAt - now) / 1000))}s`}
                    </span>
                  </div>
                )}

                <div
                  className="mb-3 flex items-center gap-3 text-[11px] font-bold"
                  style={{ color: 'rgba(255,255,255,0.4)' }}
                >
                  <span>
                    🔒 {lockedInCount}/{activeCount} locked
                  </span>
                  {allLockedIn && <span style={{ color: '#4ade80' }}>All locked!</span>}
                </div>

                <p className="text-base font-semibold text-white">{q.question.prompt}</p>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  {q.question.choices.map((c, i) => {
                    const isAnswer = hostState?.currentAnswerIndex === i;
                    return (
                      <div
                        key={i}
                        className={`answer-card ${isAnswer ? 'answer-correct' : ''}`}
                        style={{ cursor: 'default' }}
                      >
                        <div className="flex items-center">
                          <span className="answer-letter">{String.fromCharCode(65 + i)}</span>
                          <span className="flex-1">{c}</span>
                          {isAnswer && <span className="ml-2">✓</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {q.question.category} · {q.question.value} pts · {q.locked ? 'Locked' : 'Open'}
                </div>
              </div>
            )}

            {/* Boss HP */}
            {boss && <BossBar hp={boss.hp} maxHp={boss.maxHp} />}

            {/* Final Results */}
            {phase === 'ended' &&
              (room?.players.length ?? 0) > 0 &&
              (() => {
                const sorted = [...(room?.players ?? [])].sort((a, b) => b.score - a.score);
                const podium = sorted.slice(0, 3);
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <div className="game-card p-6">
                    <h2
                      className="mb-6 text-center text-2xl font-bold text-white"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      🏆 Game Over!
                    </h2>
                    <div className="flex items-end justify-center gap-4">
                      {podium.map((p, i) => {
                        const heights = [160, 130, 110];
                        const gradients = [
                          'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))',
                          'linear-gradient(135deg, rgba(148,163,184,0.1), rgba(148,163,184,0.03))',
                          'linear-gradient(135deg, rgba(234,88,12,0.1), rgba(234,88,12,0.03))',
                        ];
                        const borders = [
                          'rgba(245,158,11,0.3)',
                          'rgba(148,163,184,0.2)',
                          'rgba(234,88,12,0.2)',
                        ];
                        const order = [2, 1, 3];
                        return (
                          <div
                            key={p.playerId}
                            className={`podium-${i === 0 ? '1st' : i === 1 ? '2nd' : '3rd'} flex flex-col items-center rounded-2xl p-4`}
                            style={{
                              order: order[i],
                              minWidth: i === 0 ? 120 : 100,
                              height: heights[i],
                              background: gradients[i],
                              border: `1px solid ${borders[i]}`,
                              justifyContent: 'center',
                            }}
                          >
                            <span className="text-3xl">{medals[i]}</span>
                            <span className="mt-1 text-sm font-bold text-white">{p.name}</span>
                            <span
                              className="text-xl font-black tabular-nums"
                              style={{ fontFamily: 'var(--font-display)', color: '#fbbf24' }}
                            >
                              {p.score}
                            </span>
                            <span
                              className="text-[10px]"
                              style={{ color: 'rgba(255,255,255,0.4)' }}
                            >
                              points
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    {/* Full rankings */}
                    <div className="mt-5 space-y-1.5">
                      {sorted.map((p, rank) => (
                        <PlayerRow
                          key={p.playerId}
                          name={`${rank + 1}. ${p.name}`}
                          lives={p.lives}
                          score={p.score}
                          coins={p.coins}
                          connected={p.connected}
                          eliminated={p.eliminated}
                          buffs={p.buffs}
                          hasBuyback={(p.inventory['buyback_token'] ?? 0) > 0}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}
          </div>

          {/* RIGHT: Players + Log */}
          <div className="space-y-4">
            {/* Players */}
            <div className="game-card p-5">
              <div
                className="mb-3 text-[10px] font-bold tracking-wider uppercase"
                style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-display)' }}
              >
                Players ({room?.players.length ?? 0})
              </div>
              {(room?.players.length ?? 0) === 0 && (
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  No players yet. Share the code or LAN URL.
                </p>
              )}
              <div className="space-y-1.5">
                {(room?.players ?? []).map((p) => (
                  <PlayerRow
                    key={p.playerId}
                    name={p.name}
                    lives={p.lives}
                    score={p.score}
                    coins={p.coins}
                    connected={p.connected}
                    eliminated={p.eliminated}
                    lockedIn={p.lockedIn}
                    buffs={p.buffs}
                    hasBuyback={(p.inventory['buyback_token'] ?? 0) > 0}
                  />
                ))}
              </div>
            </div>

            {/* Event Log */}
            <div className="game-card p-5">
              <button
                type="button"
                className="flex w-full items-center justify-between"
                onClick={() => setShowLog((v) => !v)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'white' }}
              >
                <span
                  className="text-[10px] font-bold tracking-wider uppercase"
                  style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-display)' }}
                >
                  Event Log
                </span>
                <span className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  {showLog ? '▼' : '▶'}
                </span>
              </button>
              {showLog && (
                <div
                  className="mt-3 max-h-48 overflow-y-auto rounded-xl p-3 font-mono text-[11px]"
                  style={{ background: 'rgba(0,0,0,0.3)', color: 'rgba(255,255,255,0.45)' }}
                >
                  {log.length === 0 && (
                    <p style={{ color: 'rgba(255,255,255,0.2)' }}>No events yet…</p>
                  )}
                  {log.map((entry, i) => (
                    <div key={i} className="py-0.5">
                      {entry}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
