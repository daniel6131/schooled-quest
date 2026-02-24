'use client';

import { logger } from '@/lib/logger';
import { getSocket } from '@/lib/socket';
import type { Ack, HostRoomState, PublicRoomState } from '@/lib/types';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

const LS_HOST_KEY = 'sq_hostKey';
const LOCAL_STORAGE_EVENT = 'sq:localstorage';

type ActId = 'homeroom' | 'pop_quiz' | 'field_trip' | 'boss_fight';

const ACT_META: Record<ActId, { name: string; emoji: string; color: string }> = {
  homeroom: { name: 'Homeroom', emoji: '🏫', color: 'green' },
  pop_quiz: { name: 'Pop Quiz', emoji: '📝', color: 'amber' },
  field_trip: { name: 'Field Trip', emoji: '🎒', color: 'orange' },
  boss_fight: { name: 'Boss Fight', emoji: '🐉', color: 'red' },
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
    s.on('room:state', onRoom);
    s.on('host:state', onHost);
    return () => {
      s.off('room:state', onRoom);
      s.off('host:state', onHost);
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

  // ── Initial connect + reconnect: re-resume as host ──
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

    // Fire immediately if already connected
    if (s.connected) doResume();

    // Also fire on every (re)connect
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

  const pendingRevive = hostState?.pendingRevive ?? null;

  if (!roomCode) {
    return (
      <main className="flex min-h-full items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border p-6">
          <h1 className="text-xl font-bold">Invalid room</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-full p-6">
      {/* ── Revive Request Modal (blocks host screen until decided) ── */}
      {pendingRevive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="w-full max-w-md rounded-2xl border-2 border-emerald-400 bg-white p-8 shadow-2xl">
            <div className="text-center">
              <div className="text-5xl">🙏</div>
              <h2 className="mt-4 text-2xl font-bold text-emerald-800">Revive Shrine</h2>
              <p className="mt-2 text-lg text-neutral-700">
                <span className="font-bold">{pendingRevive.playerName}</span> is requesting to be
                revived!
              </p>
              <p className="mt-3 text-sm text-neutral-500">
                Have them complete the real-world forfeit. Then approve or decline.
              </p>
            </div>
            <div className="mt-8 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => emitHost('revive:approve', {}, 'Approve Revive')}
                className="rounded-xl bg-emerald-600 px-4 py-3 text-base font-bold text-white hover:bg-emerald-700"
              >
                ✅ Approve
              </button>
              <button
                type="button"
                onClick={() => emitHost('revive:decline', {}, 'Decline Revive')}
                className="rounded-xl bg-red-600 px-4 py-3 text-base font-bold text-white hover:bg-red-700"
              >
                ❌ Decline
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-4xl space-y-5">
        {/* ── Header ── */}
        <header className="rounded-2xl border p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-sm text-neutral-500">Host Dashboard</div>
              <h1 className="text-2xl font-bold">
                {hostName ? `${hostName}'s Room` : 'Host Room'}
              </h1>
              <div className="mt-1 text-sm text-neutral-600">
                Code: <span className="font-mono text-lg font-bold">{roomCode}</span>
              </div>
              {lanUrl && (
                <div className="mt-1 text-sm text-neutral-600">
                  LAN: <span className="font-mono">{lanUrl}</span>
                </div>
              )}
            </div>
            <div className="text-right">
              <div className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-semibold">
                Phase: {phase}
              </div>
              {currentAct && (
                <div className="mt-1 text-xs text-neutral-500">
                  {currentAct.emoji} {currentAct.name} · Q{currentAct.questionNumber}/
                  {currentAct.totalQuestions}
                </div>
              )}
              <div className="mt-1 text-xs text-neutral-500">
                Questions left: {room?.remainingQuestions ?? '?'}
              </div>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </header>

        {/* ── Current Act Banner ── */}
        {currentAct && (
          <section
            className={`rounded-2xl border p-4 ${
              currentAct.heartsAtRisk ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">
                  {currentAct.emoji} {currentAct.name}
                </h2>
                <p className="text-sm text-neutral-600">{currentAct.description}</p>
              </div>
              <div className="text-right text-sm">
                <div
                  className={`rounded-full px-3 py-1 text-xs font-bold ${
                    currentAct.heartsAtRisk
                      ? 'bg-red-100 text-red-700'
                      : 'bg-green-100 text-green-700'
                  }`}
                >
                  {currentAct.heartsAtRisk ? '❤️ Hearts at risk' : '🛡️ Hearts safe'}
                </div>
                <div className="mt-1 text-xs text-neutral-500">
                  Progress: {currentAct.questionNumber}/{currentAct.totalQuestions}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Game Flow ── */}
        <section className="rounded-2xl border p-5">
          <h2 className="text-lg font-semibold">Game Flow</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Start Act → Questions → Reveal → (Shop) → Next Question → … → Intermission → Next Act
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {/* Start Game / Next Question */}
            <button
              className="rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40"
              disabled={phase !== 'lobby' && phase !== 'shop' && phase !== 'reveal'}
              onClick={() => {
                if (phase === 'lobby') {
                  emitHost('game:start', {}, 'Start Game (Act 1)');
                } else {
                  emitHost('question:next', {}, 'Next Question');
                }
              }}
              type="button"
            >
              {phase === 'lobby' ? '▶ Start Game' : '⏭ Next Question'}
            </button>
            {/* Reveal */}
            <button
              className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40"
              disabled={!canReveal}
              onClick={() => emitHost('question:reveal', {}, 'Reveal Answer')}
              type="button"
            >
              👁 Reveal Answer
            </button>
            {/* Shop */}
            <button
              className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40"
              disabled={phase !== 'reveal' && phase !== 'shop' && phase !== 'intermission'}
              onClick={() =>
                emitHost('shop:open', { open: !shopOpen }, shopOpen ? 'Close Shop' : 'Open Shop')
              }
              type="button"
            >
              🛒 {shopOpen ? 'Close Shop' : 'Open Shop'}
            </button>
            {/* Boss (only available as an act transition from intermission) */}
            <button
              className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
              disabled={!availableActs.includes('boss_fight') || !isIntermission}
              onClick={() => emitHost('act:start', { actId: 'boss_fight' }, 'Start Boss Fight')}
              type="button"
            >
              🐉 Start Boss
            </button>
            {/* End Game */}
            <button
              className="rounded-xl bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-neutral-900 disabled:opacity-40"
              disabled={phase === 'ended'}
              onClick={() => emitHost('game:end', {}, 'End Game')}
              type="button"
            >
              🏁 End Game
            </button>{' '}
          </div>

          {/* ── Act Transitions (during intermission) ── */}
          {isIntermission && availableActs.length > 0 && (
            <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
              <h3 className="text-sm font-bold text-blue-800">
                🎬 {currentAct?.name} complete! Start next act:
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {availableActs.map((actId) => {
                  const meta = ACT_META[actId];
                  return (
                    <button
                      key={actId}
                      type="button"
                      onClick={() => emitHost('act:start', { actId }, `Start ${meta.name}`)}
                      className={`rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors ${
                        actId === 'boss_fight'
                          ? 'bg-red-600 hover:bg-red-700'
                          : actId === 'field_trip'
                            ? 'bg-orange-600 hover:bg-orange-700'
                            : actId === 'pop_quiz'
                              ? 'bg-amber-600 hover:bg-amber-700'
                              : 'bg-green-600 hover:bg-green-700'
                      }`}
                    >
                      {meta.emoji} Start {meta.name}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-blue-600">
                💡 You can also open the Shop first, then start the next act.
              </p>
            </div>
          )}
        </section>

        {/* ── Current Question ── */}
        {q && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="text-lg font-semibold">
              {phase === 'boss' ? '🐉 Boss Question' : '❓ Current Question'}
            </h2>

            {/* Hearts at risk indicator */}
            {q.question.hard && (
              <span className="mt-1 inline-block rounded-full bg-red-100 px-2 py-0.5 text-xs font-bold text-red-700">
                ⚠️ HARD — hearts at risk
              </span>
            )}

            {/* Timer / Countdown */}
            {isCountdown ? (
              <div className="mt-3 flex items-center justify-center gap-3 rounded-xl border bg-blue-50 px-3 py-4">
                <span className="text-3xl font-black text-blue-600 tabular-nums">
                  {countdownSecondsLeft}
                </span>
                <span className="text-sm font-semibold text-blue-700">Countdown…</span>
              </div>
            ) : (
              <div className="mt-3 flex items-center justify-between rounded-xl border bg-white px-3 py-2 text-sm">
                <span className="font-semibold">⏱️ Reveal in</span>
                <span className="font-bold tabular-nums">
                  {q.locked ? '—' : `${Math.max(0, Math.ceil((revealAt - now) / 1000))}s`}
                </span>
              </div>
            )}

            <p className="mt-2 text-xs font-semibold text-neutral-700">
              🔒 Locked in:{' '}
              <span className="tabular-nums">
                {lockedInCount}/{activeCount}
              </span>
              {allLockedIn ? ' · All locked!' : ''}
            </p>

            <p className="mt-2 text-sm font-medium">{q.question.prompt}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {q.question.choices.map((c, i) => (
                <div
                  key={i}
                  className={`rounded-lg border px-3 py-2 text-sm ${
                    hostState?.currentAnswerIndex === i
                      ? 'border-green-500 bg-green-100 font-bold'
                      : 'border-neutral-200 bg-white'
                  }`}
                >
                  {String.fromCharCode(65 + i)}: {c}
                  {hostState?.currentAnswerIndex === i && ' ✅'}
                </div>
              ))}
            </div>
            <div className="mt-2 text-xs text-neutral-500">
              {q.question.category} · {q.question.value} pts · {q.locked ? 'Locked' : 'Open'}
            </div>
          </section>
        )}

        {/* ── Boss HP ── */}
        {boss && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-5">
            <h2 className="text-lg font-semibold">🐉 Boss Fight</h2>
            <div className="mt-2 text-sm">
              HP: <span className="font-bold">{boss.hp}</span> / {boss.maxHp}
            </div>
            <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-red-200">
              <div
                className="h-full bg-red-500 transition-all"
                style={{ width: `${(boss.hp / boss.maxHp) * 100}%` }}
              />
            </div>
          </section>
        )}

        {/* ── Final Results ── */}
        {phase === 'ended' &&
          (room?.players.length ?? 0) > 0 &&
          (() => {
            const sorted = [...(room?.players ?? [])].sort((a, b) => b.score - a.score);
            const podium = sorted.slice(0, 3);
            const medals = ['🥇', '🥈', '🥉'];

            return (
              <section className="rounded-2xl border-2 border-amber-300 bg-linear-to-b from-amber-50 to-white p-6">
                <h2 className="text-center text-2xl font-bold">🏆 Game Over!</h2>

                <div className="mt-5 flex items-end justify-center gap-3">
                  {podium.map((p, i) => (
                    <div
                      key={p.playerId}
                      className={`flex flex-col items-center rounded-xl border p-3 ${
                        i === 0
                          ? 'order-2 min-w-28 border-amber-300 bg-amber-50'
                          : i === 1
                            ? 'order-1 min-w-24 border-neutral-300 bg-neutral-50'
                            : 'order-3 min-w-24 border-orange-200 bg-orange-50'
                      }`}
                    >
                      <span className="text-2xl">{medals[i]}</span>
                      <span className="mt-1 text-sm font-bold">{p.name}</span>
                      <span className="mt-0.5 text-lg font-black tabular-nums">{p.score}</span>
                      <span className="text-xs text-neutral-500">points</span>
                    </div>
                  ))}
                </div>

                {/* Full rankings */}
                <div className="mt-4 space-y-1.5">
                  {sorted.map((p, rank) => (
                    <div
                      key={p.playerId}
                      className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-5 font-bold text-neutral-400">{rank + 1}.</span>
                        <span className="font-medium">{p.name}</span>
                        {p.eliminated && <span className="text-xs text-red-500">💀</span>}
                      </div>
                      <span className="font-bold tabular-nums">{p.score}</span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })()}

        {/* ── Players ── */}
        <section className="rounded-2xl border p-5">
          <h2 className="text-lg font-semibold">Players ({room?.players.length ?? 0})</h2>
          {(room?.players.length ?? 0) === 0 && (
            <p className="mt-2 text-sm text-neutral-500">
              No players yet. Share the code or LAN URL.
            </p>
          )}
          <div className="mt-3 space-y-2">
            {(room?.players ?? []).map((p) => (
              <div
                key={p.playerId}
                className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                  p.eliminated ? 'bg-neutral-50 opacity-60' : ''
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.eliminated && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
                      💀
                    </span>
                  )}
                  {p.buffs?.doublePoints && (
                    <span
                      className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800"
                      title="Double Points armed"
                    >
                      ⭐ 2×
                    </span>
                  )}
                  {p.buffs?.shield && (
                    <span
                      className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800"
                      title="Shield armed"
                    >
                      🛡️
                    </span>
                  )}
                  {(p.inventory['buyback_token'] ?? 0) > 0 && (
                    <span
                      className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800"
                      title="Has buyback token"
                    >
                      🪙
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-neutral-600">
                  <span>❤️ {p.lives}</span>
                  <span>⭐ {p.score}</span>
                  <span>🪙 {p.coins}</span>
                  <span className={p.connected ? 'text-green-600' : 'text-red-500'}>
                    {p.connected ? '●' : '○'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Event Log ── */}
        <section className="rounded-2xl border p-5">
          <h2 className="text-lg font-semibold">Event Log</h2>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-neutral-50 p-3 font-mono text-xs">
            {log.length === 0 && <p className="text-neutral-400">No events yet…</p>}
            {log.map((entry, i) => (
              <div key={i} className="py-0.5">
                {entry}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
