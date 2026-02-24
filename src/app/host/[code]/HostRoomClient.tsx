'use client';

import { getSocket } from '@/lib/socket';
import type { Ack, HostRoomState, PublicRoomState } from '@/lib/types';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

const LS_HOST_KEY = 'sq_hostKey';
const LOCAL_STORAGE_EVENT = 'sq:localstorage';

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
    fetch('/api/lan')
      .then((r) => r.json())
      .then((d: { url: string | null }) => setLanUrl(d.url))
      .catch(() => setLanUrl(null));
  }, []);

  useEffect(() => {
    if (!roomCode || !hostKey) return;
    const s = getSocket();
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
  }, [roomCode, hostKey, addLog]);

  const phase = room?.phase ?? 'lobby';
  const q = room?.currentQuestion;
  const boss = room?.boss;
  const shopOpen = room?.shop?.open ?? false;

  if (!roomCode) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border p-6">
          <h1 className="text-xl font-bold">Invalid room</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
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
              <div className="mt-1 text-xs text-neutral-500">
                Questions left: {room?.remainingQuestions ?? '?'}
              </div>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </header>

        {/* ── Game Flow ── */}
        <section className="rounded-2xl border p-5">
          <h2 className="text-lg font-semibold">Game Flow</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Start → Reveal → (optional Shop) → Next Question → …
          </p>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <button
              className="rounded-xl bg-green-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-40"
              disabled={phase !== 'lobby' && phase !== 'shop' && phase !== 'reveal'}
              onClick={() => {
                if (phase === 'lobby') {
                  emitHost('game:start', {}, 'Start Game');
                } else {
                  emitHost('question:next', {}, 'Next Question');
                }
              }}
              type="button"
            >
              {phase === 'lobby' ? '▶ Start Game' : '⏭ Next Question'}
            </button>

            <button
              className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-40"
              disabled={phase !== 'question' && phase !== 'boss'}
              onClick={() => emitHost('question:reveal', {}, 'Reveal Answer')}
              type="button"
            >
              👁 Reveal Answer
            </button>

            <button
              className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40"
              disabled={phase !== 'reveal' && phase !== 'shop'}
              onClick={() =>
                emitHost('shop:open', { open: !shopOpen }, shopOpen ? 'Close Shop' : 'Open Shop')
              }
              type="button"
            >
              🛒 {shopOpen ? 'Close Shop' : 'Open Shop'}
            </button>

            <button
              className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
              disabled={phase === 'boss' || phase === 'ended'}
              onClick={() => emitHost('boss:start', {}, 'Start Boss Fight')}
              type="button"
            >
              🐉 Start Boss
            </button>
          </div>
        </section>

        {/* ── Current Question ── */}
        {q && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="text-lg font-semibold">
              {phase === 'boss' ? '🐉 Boss Question' : '❓ Current Question'}
            </h2>
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
                  {/* Buff indicators */}
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
