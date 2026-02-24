'use client';

import { getSocket } from '@/lib/socket';
import type { Ack, PlayerRevealPayload, PublicRoomState, ShopItemId } from '@/lib/types';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const LS_PLAYER_ID_PREFIX = 'sq_playerId_';

type ItemUseAckWire = {
  room: PublicRoomState;
  itemId?: ShopItemId;
  removedIndexes?: number[];
  bonusMs?: number;
};

const ITEM_META: Record<ShopItemId, { name: string; emoji: string; kind: 'passive' | 'active' }> = {
  double_points: { name: 'Double Points', emoji: '⭐', kind: 'passive' },
  shield: { name: 'Shield', emoji: '🛡️', kind: 'passive' },
  buyback_token: { name: 'Buyback Token', emoji: '🪙', kind: 'passive' },
  fifty_fifty: { name: '50/50', emoji: '✂️', kind: 'active' },
  freeze_time: { name: 'Freeze Time', emoji: '⏱️', kind: 'active' },
};

export default function PlayRoomClient({ code }: { code: string }) {
  const params = useSearchParams();
  const nameFromUrl = (params.get('name') || '').trim();
  const roomCode = useMemo(() => (code ?? '').trim().toUpperCase(), [code]);

  const [name, setName] = useState(nameFromUrl);
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [removedIndexes, setRemovedIndexes] = useState<number[] | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [freezeBonusMs, setFreezeBonusMs] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [revealFeedback, setRevealFeedback] = useState<PlayerRevealPayload | null>(null);

  const [playerId, setPlayerId] = useState<string | null>(null);
  const localStorageChecked = useRef(false);
  const joinAttemptedRef = useRef(false);
  const currentQuestionIdRef = useRef<string | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev].slice(0, 30));
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    const stored = localStorage.getItem(`${LS_PLAYER_ID_PREFIX}${roomCode}`);
    if (stored) setTimeout(() => setPlayerId(stored), 0);
    localStorageChecked.current = true;
  }, [roomCode]);

  const emit = useCallback(
    <T, P extends Record<string, unknown> = Record<string, unknown>>(
      event: string,
      payload: P,
      cb?: (ack: Ack<T>) => void
    ) => {
      getSocket().emit(event, payload, cb);
    },
    []
  );

  useEffect(() => {
    const s = getSocket();
    const onRoomState = (nextRoom: PublicRoomState) => {
      currentQuestionIdRef.current = nextRoom.currentQuestion?.question.id ?? null;
      setRoom((prev) => {
        if (nextRoom.currentQuestion?.question.id !== prev?.currentQuestion?.question.id) {
          setSelectedAnswer(null);
          setRemovedIndexes(null);
          setFreezeBonusMs(0);
          setRevealFeedback(null);
        }
        return nextRoom;
      });
    };
    const onPlayerReveal = (payload: PlayerRevealPayload) => {
      const currentId = currentQuestionIdRef.current;
      if (currentId && payload.questionId !== currentId) return;
      setRevealFeedback(payload);
    };

    s.on('room:state', onRoomState);
    s.on('player:reveal', onPlayerReveal);
    return () => {
      s.off('room:state', onRoomState);
      s.off('player:reveal', onPlayerReveal);
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    emit<{ room: PublicRoomState }>('room:watch', { code: roomCode }, (ack) => {
      if (!ack.ok) return setError(ack.error);
      setError(null);
      setRoom(ack.data.room);
    });
  }, [emit, roomCode]);

  useEffect(() => {
    if (!roomCode || !playerId) return;
    emit<{ room: PublicRoomState; isHost: boolean }>(
      'room:resume',
      { code: roomCode, playerId },
      (ack) => {
        if (!ack.ok) return console.warn('room:resume failed:', ack.error);
        setError(null);
        setRoom(ack.data.room);
        addLog('✅ Resumed');
      }
    );
  }, [emit, playerId, roomCode, addLog]);

  const doJoin = useCallback(
    (joinName: string) => {
      const trimmed = joinName.trim();
      if (!trimmed) return setError('Name is required.');
      emit<{ room: PublicRoomState; playerId: string }>(
        'room:join',
        { code: roomCode, name: trimmed },
        (ack) => {
          if (!ack.ok) return setError(ack.error);
          setError(null);
          setRoom(ack.data.room);
          setPlayerId(ack.data.playerId);
          localStorage.setItem(`${LS_PLAYER_ID_PREFIX}${roomCode}`, ack.data.playerId);
          addLog(`✅ Joined as "${trimmed}"`);
        }
      );
    },
    [emit, roomCode, addLog]
  );

  useEffect(() => {
    if (!roomCode || playerId || !nameFromUrl) return;
    if (joinAttemptedRef.current || !localStorageChecked.current) return;
    const stored = localStorage.getItem(`${LS_PLAYER_ID_PREFIX}${roomCode}`);
    if (stored) return;
    joinAttemptedRef.current = true;
    setTimeout(() => doJoin(nameFromUrl), 0);
  }, [roomCode, playerId, nameFromUrl, doJoin]);

  /* ── Actions ── */

  const submitAnswer = useCallback(
    (answerIndex: number) => {
      if (!playerId) return;

      // Allow changing answers: we always send the latest selection until time runs out / reveal locks.
      const prev = selectedAnswer;
      setSelectedAnswer(answerIndex);

      emit<{ accepted: boolean }>(
        'player:answer',
        { code: roomCode, playerId, answerIndex },
        (ack) => {
          if (!ack.ok) {
            setError(ack.error);
            // Revert optimistic UI if the server rejected (time up / locked / etc.)
            setSelectedAnswer(prev ?? null);
            addLog(`❌ ${ack.error}`);
          } else {
            addLog(`✅ Selected: ${String.fromCharCode(65 + answerIndex)}`);
          }
        }
      );
    },
    [emit, playerId, roomCode, addLog, selectedAnswer]
  );

  const lockIn = useCallback(() => {
    if (!playerId) return;
    emit<{ room: PublicRoomState }>('player:lockin', { code: roomCode, playerId }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        addLog(`❌ Lock in: ${ack.error}`);
      } else {
        setError(null);
        setRoom(ack.data.room);
        addLog('🔒 Locked in!');
      }
    });
  }, [emit, playerId, roomCode, addLog]);

  const buyItem = useCallback(
    (itemId: ShopItemId) => {
      if (!playerId) return;
      emit<{ room: PublicRoomState }>('shop:buy', { code: roomCode, playerId, itemId }, (ack) => {
        if (!ack.ok) {
          setError(ack.error);
          addLog(`❌ Buy: ${ack.error}`);
        } else {
          setError(null);
          setRoom(ack.data.room);
          addLog(`✅ Bought ${ITEM_META[itemId].name}`);
        }
      });
    },
    [emit, playerId, roomCode, addLog]
  );

  const handleUseItem = useCallback(
    (itemId: ShopItemId) => {
      if (!playerId) return;
      emit<ItemUseAckWire>('item:use', { code: roomCode, playerId, itemId }, (ack) => {
        if (!ack.ok) {
          setError(ack.error);
          addLog(`❌ Use: ${ack.error}`);
        } else {
          setError(null);
          setRoom(ack.data.room);
          if (ack.data.removedIndexes) {
            setRemovedIndexes(ack.data.removedIndexes);
            if (selectedAnswer !== null && ack.data.removedIndexes.includes(selectedAnswer)) {
              setSelectedAnswer(null);
            }
          }
          if (ack.data.bonusMs) setFreezeBonusMs((prev) => prev + (ack.data.bonusMs ?? 0));
          addLog(`✅ Used ${ITEM_META[itemId].name}`);
        }
      });
    },
    [emit, playerId, roomCode, addLog, selectedAnswer]
  );

  const doBuyback = useCallback(() => {
    if (!playerId) return;
    emit<{ room: PublicRoomState }>('player:buyback', { code: roomCode, playerId }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        addLog(`❌ ${ack.error}`);
      } else {
        setError(null);
        setRoom(ack.data.room);
        addLog('✅ Bought back in!');
      }
    });
  }, [emit, playerId, roomCode, addLog]);

  /* ── Derived ── */

  const phase = room?.phase ?? 'lobby';
  const q = room?.currentQuestion;
  const me = room?.players.find((p) => p.playerId === playerId);
  const shopOpen = room?.shop?.open ?? false;
  const isQuestionPhase = phase === 'question' || phase === 'boss';
  const revealAt = q ? (q.revealAt ?? q.endsAt) : 0;
  const personalEndsAt = q ? q.endsAt + freezeBonusMs : 0;
  const playerEndsAt = q ? Math.min(revealAt, personalEndsAt) : 0;
  const msLeft = q ? Math.max(0, playerEndsAt - now) : 0;
  const secondsLeft = q ? Math.ceil(msLeft / 1000) : 0;
  const totalMs = q ? Math.max(1, playerEndsAt - q.startedAt) : 1;
  const remainingFrac = q ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
  const timeUp = q ? now >= playerEndsAt : false;
  const revealedCorrectIndex = q?.revealedAnswerIndex;

  const activePlayers = (room?.players ?? []).filter((p) => p.connected && !p.eliminated);
  const lockedInCount = activePlayers.filter((p) => p.lockedIn).length;
  const activeCount = activePlayers.length;

  // Separate inventory into active vs passive for display
  const activeItems = Object.entries(me?.inventory ?? {}).filter(
    ([id, count]) => count > 0 && ITEM_META[id as ShopItemId]?.kind === 'active'
  ) as [ShopItemId, number][];

  const passiveItems = Object.entries(me?.inventory ?? {}).filter(
    ([id, count]) => count > 0 && ITEM_META[id as ShopItemId]?.kind === 'passive'
  ) as [ShopItemId, number][];

  if (!roomCode) {
    return (
      <main className="min-h-screen p-6">
        <div className="mx-auto max-w-md rounded-2xl border p-6">
          <h1 className="text-xl font-bold">Invalid room</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-3xl space-y-5">
        {/* ── Header + Stats + Buffs ── */}
        <header className="rounded-2xl border p-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-sm text-neutral-500">Player</div>
              <h1 className="text-2xl font-bold">{me?.name ?? 'Room'}</h1>
              <div className="mt-1 text-sm text-neutral-600">
                Code: <span className="font-mono font-semibold">{roomCode}</span>
              </div>
            </div>
            <div className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-semibold">
              {phase}
            </div>
          </div>

          {me && (
            <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
              <span>
                ❤️ {me.lives}/{room?.config.maxLives}
              </span>
              <span>⭐ {me.score}</span>
              <span>🪙 {me.coins}</span>
              {me.eliminated && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                  💀 ELIMINATED
                </span>
              )}
            </div>
          )}

          {/* Passive buff indicators */}
          {me &&
            (me.buffs?.doublePoints ||
              me.buffs?.shield ||
              (me.inventory['buyback_token'] ?? 0) > 0) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {me.buffs?.doublePoints && (
                  <span className="rounded-full border border-yellow-300 bg-yellow-100 px-3 py-1 text-xs font-semibold text-yellow-800">
                    ⭐ Double Points armed
                  </span>
                )}
                {me.buffs?.shield && (
                  <span className="rounded-full border border-blue-300 bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
                    🛡️ Shield armed
                  </span>
                )}
                {(me.inventory['buyback_token'] ?? 0) > 0 && (
                  <span className="rounded-full border border-green-300 bg-green-100 px-3 py-1 text-xs font-semibold text-green-800">
                    🪙 Buyback Token ready
                  </span>
                )}
              </div>
            )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </header>

        {/* ── Join ── */}
        {!playerId && !nameFromUrl && (
          <section className="rounded-2xl border p-5">
            <h2 className="text-lg font-semibold">Join</h2>
            <div className="mt-3 flex gap-2">
              <input
                className="w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button
                className="rounded-xl border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                type="button"
                onClick={() => doJoin(name)}
              >
                Join
              </button>
            </div>
          </section>
        )}
        {!playerId && nameFromUrl && (
          <section className="rounded-2xl border p-5">
            <p className="text-sm text-neutral-600">Joining as {nameFromUrl}…</p>
          </section>
        )}

        {/* ── Question + Answers ── */}
        {q && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {phase === 'boss' ? '🐉 Boss Question' : '❓ Question'}
              </h2>
              <span className="text-xs text-neutral-500">
                {q.question.value} pts · {q.question.category}
              </span>
            </div>

            {freezeBonusMs > 0 && (
              <p className="mt-1 text-xs font-medium text-blue-600">
                ⏱️ +{freezeBonusMs / 1000}s bonus time!
              </p>
            )}

            {/* Timer */}
            <div className="mt-3 rounded-xl border bg-white p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold">{timeUp ? '⏱️ Time’s up' : '⏱️ Time left'}</span>
                <span className="font-bold tabular-nums">{secondsLeft}s</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-200">
                <div
                  className="h-2 bg-blue-500 transition-[width]"
                  style={{ width: `${Math.round(remainingFrac * 100)}%` }}
                />
              </div>
            </div>

            <p className="mt-2 text-base font-medium">{q.question.prompt}</p>
            {/* Reveal feedback */}
            {q.locked && revealFeedback && (
              <div
                className={`mt-3 rounded-xl border p-3 text-sm font-semibold ${
                  revealFeedback.correct
                    ? 'border-green-300 bg-green-50 text-green-800'
                    : revealFeedback.yourAnswerIndex === null
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-red-300 bg-red-50 text-red-800'
                }`}
              >
                {revealFeedback.correct
                  ? `✅ Correct! +${revealFeedback.scoreDelta} pts`
                  : revealFeedback.yourAnswerIndex === null
                    ? '⏱️ No answer submitted'
                    : '❌ Wrong'}
                <span className="ml-2 font-medium text-neutral-700">
                  {revealFeedback.shieldUsed ? '🛡️ Shield used' : ''}
                  {revealFeedback.doublePointsUsed ? '⭐ Double Points used' : ''}
                  {revealFeedback.buybackUsed ? '🪙 Buyback used' : ''}
                  {revealFeedback.livesDelta !== 0 ? ` · ${revealFeedback.livesDelta} lives` : ''}
                  {revealFeedback.coinsDelta !== 0 ? ` · ${revealFeedback.coinsDelta} coins` : ''}
                </span>
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {q.question.choices.map((choice, i) => {
                const isRemoved = removedIndexes?.includes(i);
                const isSelected = selectedAnswer === i;
                const showReveal = q.locked && typeof revealedCorrectIndex === 'number';
                const isCorrect = showReveal && i === revealedCorrectIndex;
                const yourIdx = revealFeedback?.yourAnswerIndex ?? selectedAnswer;
                const isYourPick = yourIdx === i;
                const isWrongPick = showReveal && isYourPick && !isCorrect;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={
                      q.locked || timeUp || !!me?.eliminated || !!me?.lockedIn || !!isRemoved
                    }
                    onClick={() => submitAnswer(i)}
                    className={`rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition-all ${
                      isRemoved
                        ? 'border-neutral-200 bg-neutral-100 text-neutral-400 line-through'
                        : isCorrect
                          ? 'border-green-500 bg-green-50 text-green-800'
                          : isWrongPick
                            ? 'border-red-500 bg-red-50 text-red-800'
                            : isSelected
                              ? 'border-blue-500 bg-blue-50 text-blue-800'
                              : 'border-neutral-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                    } disabled:cursor-not-allowed`}
                  >
                    <span className="mr-2 font-bold text-neutral-400">
                      {String.fromCharCode(65 + i)}
                    </span>
                    {choice}
                    {showReveal
                      ? isCorrect
                        ? ' ✅'
                        : isWrongPick
                          ? ' ❌'
                          : ''
                      : isSelected
                        ? ' ✓'
                        : ''}
                  </button>
                );
              })}
            </div>

            {/* Lock In */}
            {isQuestionPhase && !q.locked && !me?.eliminated && activeCount > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border bg-white p-3">
                <div className="text-xs font-semibold text-neutral-700">
                  🔒 Locked in:{' '}
                  <span className="tabular-nums">
                    {lockedInCount}/{activeCount}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={lockIn}
                  disabled={timeUp || !!me?.lockedIn || selectedAnswer === null}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {me?.lockedIn ? '✅ Locked In' : '🔒 Lock In'}
                </button>
              </div>
            )}

            {/* Active items — usable during question */}
            {isQuestionPhase && activeItems.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-amber-200 pt-3">
                <span className="self-center text-xs text-neutral-500">Use:</span>
                {activeItems.map(([itemId, count]) => (
                  <button
                    key={itemId}
                    type="button"
                    disabled={q.locked || timeUp || !!me?.eliminated || !!me?.lockedIn}
                    onClick={() => handleUseItem(itemId)}
                    className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {ITEM_META[itemId].emoji} {ITEM_META[itemId].name}
                    {count > 1 && ` ×${count}`}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs font-medium text-blue-700">
              {q.locked
                ? 'Answer revealed.'
                : timeUp
                  ? '⏱️ Time’s up — waiting for the host to reveal…'
                  : me?.lockedIn
                    ? '🔒 Locked in — waiting for the host to reveal…'
                    : selectedAnswer === null
                      ? 'Tap an answer to submit. You can change it until you lock in or time runs out.'
                      : `Selected ${String.fromCharCode(65 + selectedAnswer)} — tap another option to change before you lock in or time runs out.`}
            </p>
          </section>
        )}

        {/* ── Eliminated ── */}
        {me?.eliminated && (
          <section className="rounded-2xl border border-red-200 bg-red-50 p-5">
            <h2 className="text-lg font-semibold text-red-800">💀 You&apos;re Eliminated</h2>
            <p className="mt-1 text-sm text-red-700">
              Wait for the shop to open, then buy back in with coins.
            </p>
            {shopOpen && (
              <button
                type="button"
                onClick={doBuyback}
                className="mt-3 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700"
              >
                🪙 Buyback ({room?.config.buybackCostCoins} coins)
              </button>
            )}
          </section>
        )}

        {/* ── Shop ── */}
        {shopOpen && (
          <section className="rounded-2xl border border-purple-200 bg-purple-50 p-5">
            <h2 className="text-lg font-semibold text-purple-800">🛒 Shop</h2>
            <p className="mt-1 text-xs text-purple-600">
              Your coins: <span className="font-bold">{me?.coins ?? 0}</span>
            </p>

            <div className="mt-3 space-y-2">
              {(room?.shop?.items ?? []).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-xl border border-purple-200 bg-white px-4 py-3"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {ITEM_META[item.id]?.emoji} {item.name}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          item.kind === 'passive'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-orange-100 text-orange-700'
                        }`}
                      >
                        {item.kind === 'passive' ? 'auto' : 'use'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500">{item.description}</div>
                    <div className="mt-0.5 text-xs font-semibold text-purple-700">
                      🪙 {item.cost}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={(me?.coins ?? 0) < item.cost}
                    onClick={() => buyItem(item.id)}
                    className="ml-3 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-40"
                  >
                    Buy
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ── Inventory (non-shop view) ── */}
        {!shopOpen && (passiveItems.length > 0 || activeItems.length > 0) && (
          <section className="rounded-2xl border p-5">
            <h2 className="text-lg font-semibold">🎒 Inventory</h2>

            {passiveItems.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 text-xs text-neutral-500">Passive (auto-trigger):</p>
                <div className="flex flex-wrap gap-2">
                  {passiveItems.map(([itemId, count]) => (
                    <div
                      key={itemId}
                      className="flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-800"
                    >
                      {ITEM_META[itemId].emoji} {ITEM_META[itemId].name}
                      {count > 1 && ` ×${count}`}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeItems.length > 0 && (
              <div className="mt-3">
                <p className="mb-2 text-xs text-neutral-500">Active (use during questions):</p>
                <div className="flex flex-wrap gap-2">
                  {activeItems.map(([itemId, count]) => (
                    <div
                      key={itemId}
                      className="flex items-center gap-1.5 rounded-lg border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-800"
                    >
                      {ITEM_META[itemId].emoji} {ITEM_META[itemId].name}
                      {count > 1 && ` ×${count}`}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {removedIndexes && (
              <p className="mt-2 text-xs text-neutral-600">
                50/50 removed: {removedIndexes.map((i) => String.fromCharCode(65 + i)).join(', ')}
              </p>
            )}
          </section>
        )}

        {/* ── Scoreboard ── */}
        <section className="rounded-2xl border p-5">
          <h2 className="text-lg font-semibold">Scoreboard</h2>
          <div className="mt-3 space-y-2">
            {[...(room?.players ?? [])]
              .sort((a, b) => b.score - a.score)
              .map((p, rank) => (
                <div
                  key={p.playerId}
                  className={`flex items-center justify-between rounded-xl border px-4 py-2.5 ${
                    p.playerId === playerId ? 'border-blue-300 bg-blue-50' : ''
                  } ${p.eliminated ? 'opacity-50' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-5 text-sm font-bold text-neutral-400">{rank + 1}.</span>
                    <span className="text-sm font-medium">
                      {p.name}
                      {p.playerId === playerId && ' (you)'}
                    </span>
                    {p.eliminated && <span className="text-xs text-red-500">💀</span>}
                    {p.buffs?.doublePoints && (
                      <span className="text-xs" title="Double Points">
                        ⭐
                      </span>
                    )}
                    {p.buffs?.shield && (
                      <span className="text-xs" title="Shield">
                        🛡️
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-neutral-600">
                    <span>❤️ {p.lives}</span>
                    <span>⭐ {p.score}</span>
                    <span>🪙 {p.coins}</span>
                  </div>
                </div>
              ))}
          </div>
        </section>

        {/* ── Event Log ── */}
        <section className="rounded-2xl border p-5">
          <h2 className="text-lg font-semibold">Event Log</h2>
          <div className="mt-2 max-h-36 overflow-y-auto rounded-lg bg-neutral-50 p-3 font-mono text-xs">
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
