/* eslint-disable @typescript-eslint/no-unused-vars */
'use client';

import {
  ActBanner,
  BossBar,
  BuffIndicators,
  PhaseChip,
  PlayerRow,
  StatBar,
  TimerRing,
  WagerStages,
  WagerTierBadge,
} from '@/components/game/gamePrimitives';
import { logger } from '@/lib/logger';
import { getSocket } from '@/lib/socket';
import type {
  Ack,
  PlayerRevealPayload,
  PublicRoomState,
  ShopItemId,
  WagerSpotlightPayload,
  WagerStage,
  WagerTier,
} from '@/lib/types';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/* ════════════════════════════════════════════════════════
   ALL LOGIC BELOW IS UNCHANGED FROM ORIGINAL
   ════════════════════════════════════════════════════════ */

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
  const [wagerAmount, setWagerAmount] = useState(0);
  const [wagerExtraHint, setWagerExtraHint] = useState<string | null>(null);
  const [wagerSiren, setWagerSiren] = useState(false);
  const [spotlight, setSpotlight] = useState<WagerSpotlightPayload | null>(null);
  const [lockedInBonusPreview, setLockedInBonusPreview] = useState<number | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const localStorageChecked = useRef(false);
  const joinAttemptedRef = useRef(false);
  const currentQuestionIdRef = useRef<string | null>(null);
  const [reviveStatus, setReviveStatus] = useState<'idle' | 'pending' | 'approved' | 'declined'>(
    'idle'
  );

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

  const rejoinRoom = useCallback(() => {
    if (!roomCode) return;
    const s = getSocket();
    const currentPid = playerId ?? localStorage.getItem(`${LS_PLAYER_ID_PREFIX}${roomCode}`);
    if (currentPid) {
      s.emit(
        'room:resume',
        { code: roomCode, playerId: currentPid },
        (ack: Ack<{ room: PublicRoomState; isHost: boolean }>) => {
          if (!ack.ok) {
            logger.warn({ error: ack.error }, 'room:resume failed, clearing stale playerId');
            localStorage.removeItem(`${LS_PLAYER_ID_PREFIX}${roomCode}`);
            setPlayerId(null);
            joinAttemptedRef.current = false;
            s.emit('room:watch', { code: roomCode }, (watchAck: Ack<{ room: PublicRoomState }>) => {
              if (watchAck.ok) setRoom(watchAck.data.room);
            });
            return;
          }
          setError(null);
          setRoom(ack.data.room);
          addLog('✅ Resumed');
        }
      );
    } else {
      s.emit('room:watch', { code: roomCode }, (ack: Ack<{ room: PublicRoomState }>) => {
        if (!ack.ok) return setError(ack.error);
        setError(null);
        setRoom(ack.data.room);
      });
    }
  }, [roomCode, playerId, addLog]);

  useEffect(() => {
    const s = getSocket();
    const onRoomState = (nextRoom: PublicRoomState) => {
      currentQuestionIdRef.current = nextRoom.currentQuestion?.question.id ?? null;
      if (nextRoom.phase !== 'wager') setSpotlight(null);
      setRoom((prev) => {
        if (nextRoom.currentQuestion?.question.id !== prev?.currentQuestion?.question.id) {
          setSelectedAnswer(null);
          setRemovedIndexes(null);
          setFreezeBonusMs(0);
          setRevealFeedback(null);
          setLockedInBonusPreview(null);
        }
        if (nextRoom.wager?.endsAt !== prev?.wager?.endsAt) {
          setWagerExtraHint(null);
          setSpotlight(null);
          setWagerSiren(false);
        }
        if (nextRoom.currentAct?.id !== 'wager_round') {
          setWagerExtraHint(null);
          setSpotlight(null);
          setWagerSiren(false);
        }
        return nextRoom;
      });
    };
    const onPlayerReveal = (payload: PlayerRevealPayload) => {
      const currentId = currentQuestionIdRef.current;
      if (currentId && payload.questionId !== currentId) return;
      setRevealFeedback(payload);
    };
    const onRevivePending = () => setReviveStatus('pending');
    const onReviveResult = (payload: { approved: boolean }) => {
      setReviveStatus(payload.approved ? 'approved' : 'declined');
      setTimeout(() => setReviveStatus('idle'), 3000);
    };
    const onWagerExtraHint = (payload: { text: string }) => setWagerExtraHint(payload.text);
    const onWagerFiftyFifty = (payload: { removedIndexes: number[] }) => {
      setRemovedIndexes(payload.removedIndexes);
      setSelectedAnswer((prev) =>
        prev !== null && payload.removedIndexes.includes(prev) ? null : prev
      );
    };
    const onWagerSiren = () => {
      setWagerSiren(true);
      setTimeout(() => setWagerSiren(false), 1200);
    };
    const onWagerSpotlight = (payload: WagerSpotlightPayload) => setSpotlight(payload);

    s.on('room:state', onRoomState);
    s.on('player:reveal', onPlayerReveal);
    s.on('revive:pending', onRevivePending);
    s.on('revive:result', onReviveResult);
    s.on('wager:extra_hint', onWagerExtraHint);
    s.on('wager:fifty_fifty', onWagerFiftyFifty);
    s.on('wager:siren', onWagerSiren);
    s.on('wager:spotlight', onWagerSpotlight);
    return () => {
      s.off('room:state', onRoomState);
      s.off('player:reveal', onPlayerReveal);
      s.off('revive:pending', onRevivePending);
      s.off('revive:result', onReviveResult);
      s.off('wager:extra_hint', onWagerExtraHint);
      s.off('wager:fifty_fifty', onWagerFiftyFifty);
      s.off('wager:siren', onWagerSiren);
      s.off('wager:spotlight', onWagerSpotlight);
    };
  }, []);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!roomCode) return;
    const s = getSocket();
    if (s.connected) rejoinRoom();
    const onConnect = () => {
      logger.info({ roomCode }, 'socket (re)connected, rejoining room');
      rejoinRoom();
    };
    s.on('connect', onConnect);
    return () => {
      s.off('connect', onConnect);
    };
  }, [roomCode, rejoinRoom]);

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

  const submitAnswer = useCallback(
    (answerIndex: number) => {
      if (!playerId) return;
      const prev = selectedAnswer;
      setSelectedAnswer(answerIndex);
      emit<{ accepted: boolean }>(
        'player:answer',
        { code: roomCode, playerId, answerIndex },
        (ack) => {
          if (!ack.ok) {
            setError(ack.error);
            setSelectedAnswer(prev ?? null);
            addLog(`❌ ${ack.error}`);
          } else addLog(`✅ Selected: ${String.fromCharCode(65 + answerIndex)}`);
        }
      );
    },
    [emit, playerId, roomCode, addLog, selectedAnswer]
  );

  const lockIn = useCallback(() => {
    if (!playerId) return;
    const lockTime = Date.now();
    emit<{ room: PublicRoomState }>('player:lockin', { code: roomCode, playerId }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        addLog(`❌ Lock in: ${ack.error}`);
      } else {
        setError(null);
        setRoom((prev) => {
          const sbMax = prev?.currentAct?.speedBonusMax ?? 0;
          const startedAt = prev?.currentQuestion?.startedAt ?? lockTime;
          const baseDurationMs = (prev?.currentQuestion?.endsAt ?? lockTime) - startedAt;
          if (sbMax > 0 && baseDurationMs > 0) {
            const elapsed = lockTime - startedAt;
            const frac = Math.max(0, 1 - elapsed / baseDurationMs);
            setLockedInBonusPreview(Math.floor(sbMax * frac));
          }
          return ack.data.room;
        });
        addLog('🔒 Locked in!');
      }
    });
  }, [emit, playerId, roomCode, addLog]);

  const submitWager = useCallback(
    (amount: number) => {
      if (!playerId) return;
      emit<{ room: PublicRoomState }>('wager:set', { code: roomCode, playerId, amount }, (ack) => {
        if (!ack.ok) {
          setError(ack.error);
          addLog(`❌ Wager: ${ack.error}`);
        } else {
          setError(null);
          setRoom(ack.data.room);
        }
      });
    },
    [emit, playerId, roomCode, addLog]
  );

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
            if (selectedAnswer !== null && ack.data.removedIndexes.includes(selectedAnswer))
              setSelectedAnswer(null);
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

  const requestRevive = useCallback(() => {
    if (!playerId) return;
    emit<{ pending: true }>('revive:request', { code: roomCode, playerId }, (ack) => {
      if (!ack.ok) {
        setError(ack.error);
        addLog(`❌ Revive: ${ack.error}`);
      } else {
        setError(null);
        setReviveStatus('pending');
        addLog('🙏 Revive requested — waiting for host…');
      }
    });
  }, [emit, playerId, roomCode, addLog]);

  /* ── Derived ── */
  const phase = room?.phase ?? 'lobby';
  const q = room?.currentQuestion;
  const me = room?.players.find((p) => p.playerId === playerId);
  const wager = room?.wager;
  const shopOpen = room?.shop?.open ?? false;
  const isCountdown = phase === 'countdown';
  const isWager = phase === 'wager';
  const isQuestionPhase = phase === 'question' || phase === 'boss';
  const currentAct = room?.currentAct;
  const countdownEndsAt = q?.countdownEndsAt ?? 0;
  const countdownMsLeft = isCountdown ? Math.max(0, countdownEndsAt - now) : 0;
  const countdownSecondsLeft = Math.ceil(countdownMsLeft / 1000);
  const revealAt = q ? (q.revealAt ?? q.endsAt) : 0;
  const personalEndsAt = q ? q.endsAt + freezeBonusMs : 0;
  const playerEndsAt = q ? Math.min(revealAt, personalEndsAt) : 0;
  const msLeft = q ? Math.max(0, playerEndsAt - now) : 0;
  const secondsLeft = q ? Math.ceil(msLeft / 1000) : 0;
  const totalMs = q ? Math.max(1, playerEndsAt - q.startedAt) : 1;
  const remainingFrac = q ? Math.max(0, Math.min(1, msLeft / totalMs)) : 0;
  const timeUp = q ? now >= playerEndsAt : false;
  const revealedCorrectIndex = q?.revealedAnswerIndex;
  const wagerEndsAt = wager?.endsAt ?? 0;
  const wagerSecondsLeft = isWager ? Math.max(0, Math.ceil((wagerEndsAt - now) / 1000)) : 0;
  const wagerStage = (wager?.stage ?? 'blind') as WagerStage;
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
  const blackoutUntil = q?.blackoutUntil ?? 0;
  const isBlackout = isQuestionPhase && blackoutUntil > 0 && now < blackoutUntil;
  const activePlayers = (room?.players ?? []).filter((p) => p.connected && !p.eliminated);
  const lockedInCount = activePlayers.filter((p) => p.lockedIn).length;
  const activeCount = activePlayers.length;
  const activeItems = Object.entries(me?.inventory ?? {}).filter(
    ([id, count]) => count > 0 && ITEM_META[id as ShopItemId]?.kind === 'active'
  ) as [ShopItemId, number][];
  const passiveItems = Object.entries(me?.inventory ?? {}).filter(
    ([id, count]) => count > 0 && ITEM_META[id as ShopItemId]?.kind === 'passive'
  ) as [ShopItemId, number][];
  const isBossAct = currentAct?.id === 'boss_fight';
  const canRequestRevive =
    !!me?.eliminated && !isQuestionPhase && !isBossAct && reviveStatus === 'idle';
  const myScore = Math.max(0, me?.score ?? 0);
  const myRatio = myScore > 0 ? wagerAmount / myScore : 0;
  const myTier: WagerTier =
    myScore > 0 && wagerAmount >= myScore
      ? 'ALL_IN'
      : myRatio >= 0.8
        ? 'INSANE'
        : myRatio >= 0.5
          ? 'HIGH_ROLLER'
          : myRatio >= 0.25
            ? 'BOLD'
            : 'SAFE';
  const myTierIndex =
    myTier === 'SAFE'
      ? 0
      : myTier === 'BOLD'
        ? 1
        : myTier === 'HIGH_ROLLER'
          ? 2
          : myTier === 'INSANE'
            ? 3
            : 4;
  const isAllInCommitted =
    currentAct?.id === 'wager_round' &&
    (me?.score ?? 0) > 0 &&
    (me?.wager ?? 0) >= (me?.score ?? 0);
  const canFinalSwap =
    !!isAllInCommitted &&
    !!me?.lockedIn &&
    !me?.wagerSwapUsed &&
    isQuestionPhase &&
    !q?.locked &&
    !timeUp &&
    !me?.eliminated;
  const hasMe = !!me;
  const myEliminated = !!me?.eliminated;
  const myWager = me?.wager ?? 0;

  useEffect(() => {
    if (!isWager) return;
    if (!hasMe || myEliminated) return;
    const t = setTimeout(() => {
      setWagerAmount((prev) => (prev === myWager ? prev : myWager));
    }, 0);
    return () => clearTimeout(t);
  }, [isWager, hasMe, myEliminated, myWager]);

  const speedBonusMax = currentAct?.speedBonusMax ?? 0;
  const baseDurationMs = q ? q.endsAt - q.startedAt : 0;
  const liveSpeedBonus =
    q && isQuestionPhase && !q.locked && speedBonusMax > 0 && baseDurationMs > 0
      ? Math.max(0, Math.floor(speedBonusMax * (1 - (now - q.startedAt) / baseDurationMs)))
      : 0;
  const displaySpeedBonus = me?.lockedIn ? (lockedInBonusPreview ?? 0) : liveSpeedBonus;

  /* ════════════════════════════════════════════════════════
     RENDER — Cosmic Game Show Theme
     ════════════════════════════════════════════════════════ */

  if (!roomCode) {
    return (
      <main className="relative z-10 flex min-h-dvh items-center justify-center p-6">
        <div className="game-card p-8 text-center" style={{ maxWidth: 360 }}>
          <div className="mb-3 text-3xl">🚫</div>
          <h1
            className="text-lg font-bold text-white"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Invalid Room
          </h1>
        </div>
      </main>
    );
  }

  return (
    <main className="relative z-10 min-h-dvh pb-8">
      {/* ── Wager Spotlight Modal ── */}
      {spotlight && isWager && (
        <div className="game-modal-backdrop">
          <div className="game-card w-full p-6" style={{ maxWidth: 400 }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div
                  className="text-[11px] font-bold tracking-wider uppercase"
                  style={{ color: '#f472b6' }}
                >
                  🎥 Spotlight
                </div>
                <div
                  className="mt-1 text-xl font-black text-white"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  HIGH STAKES
                </div>
              </div>
              <div className="game-card-compact px-3 py-2 text-right">
                <div className="text-[10px] font-bold" style={{ color: '#f472b6' }}>
                  POT
                </div>
                <div className="text-lg font-black text-white tabular-nums">
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
                  <div className="mt-1 text-base font-black text-white tabular-nums">{s.val}</div>
                </div>
              ))}
            </div>
            {spotlight.topRisk.length > 0 && (
              <div className="mt-4 space-y-2">
                <div
                  className="text-[10px] font-bold tracking-wider uppercase"
                  style={{ color: 'rgba(255,255,255,0.35)' }}
                >
                  Top Risk Takers
                </div>
                {spotlight.topRisk.map((e, idx) => (
                  <div
                    key={e.playerId}
                    className="game-card-compact flex items-center justify-between px-4 py-2.5"
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
            <div
              className="mt-4 text-center text-[11px] font-semibold"
              style={{ color: 'rgba(255,255,255,0.3)' }}
            >
              Waiting for host to start the question…
            </div>
          </div>
        </div>
      )}

      {/* ── Revive Modals ── */}
      {reviveStatus === 'pending' && (
        <div className="game-modal-backdrop">
          <div className="game-card w-full p-8 text-center" style={{ maxWidth: 360 }}>
            <div className="text-5xl">🙏</div>
            <h2
              className="mt-4 text-xl font-bold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Revive Shrine
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Request sent — complete the forfeit!
            </p>
            <div className="mt-6 flex justify-center gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-2 w-2 animate-bounce rounded-full"
                  style={{ background: '#4ade80', animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
      {reviveStatus === 'approved' && (
        <div className="game-modal-backdrop">
          <div className="game-card w-full p-8 text-center" style={{ maxWidth: 360 }}>
            <div className="text-5xl">🎉</div>
            <h2
              className="mt-4 text-xl font-bold"
              style={{ fontFamily: 'var(--font-display)', color: '#4ade80' }}
            >
              You&apos;re Back!
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Full health restored!
            </p>
          </div>
        </div>
      )}
      {reviveStatus === 'declined' && (
        <div className="game-modal-backdrop">
          <div className="game-card w-full p-8 text-center" style={{ maxWidth: 360 }}>
            <div className="text-5xl">😔</div>
            <h2
              className="mt-4 text-xl font-bold"
              style={{ fontFamily: 'var(--font-display)', color: '#f87171' }}
            >
              Declined
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Better luck next time!
            </p>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-lg space-y-4 px-4 pt-4">
        {/* ── Sticky Header ── */}
        <header className="game-card-compact px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1
                  className="truncate text-base font-bold text-white"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {me?.name ?? 'Room'}
                </h1>
                <span
                  className="shrink-0 font-mono text-[11px] tabular-nums"
                  style={{ color: 'rgba(255,255,255,0.3)' }}
                >
                  {roomCode}
                </span>
              </div>
            </div>
            <PhaseChip phase={phase} />
          </div>
          {me && (
            <div className="mt-2.5">
              <StatBar
                lives={me.lives}
                maxLives={room?.config.maxLives ?? 3}
                score={me.score}
                coins={me.coins}
                eliminated={me.eliminated}
              />
            </div>
          )}
          {me && (
            <BuffIndicators
              doublePoints={me.buffs?.doublePoints}
              shield={me.buffs?.shield}
              buybackToken={(me.inventory['buyback_token'] ?? 0) > 0}
            />
          )}
          {error && (
            <p className="mt-2 text-xs font-medium" style={{ color: '#f87171' }}>
              {error}
            </p>
          )}
        </header>

        {/* ── Act Banner ── */}
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

        {/* ── Boss HP ── */}
        {room?.boss && <BossBar hp={room.boss.hp} maxHp={room.boss.maxHp} />}

        {/* ── Intermission ── */}
        {phase === 'intermission' && (
          <div className="game-card p-6 text-center">
            <div className="mb-2 text-3xl">🎬</div>
            <h2
              className="text-lg font-bold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Intermission
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {currentAct?.name} complete — host will start the next act soon.
            </p>
            {shopOpen && (
              <p className="mt-2 text-sm font-semibold" style={{ color: '#c084fc' }}>
                🛒 The shop is open!
              </p>
            )}
          </div>
        )}

        {/* ── Join (if not yet joined) ── */}
        {!playerId && !nameFromUrl && (
          <div className="game-card p-6">
            <h2
              className="mb-3 text-base font-bold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Join Game
            </h2>
            <div className="flex gap-2">
              <input
                className="neon-input"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doJoin(name)}
              />
              <button
                className="cta-button"
                style={{ width: 'auto', padding: '14px 24px' }}
                type="button"
                onClick={() => doJoin(name)}
              >
                <span className="relative z-10">Join</span>
              </button>
            </div>
          </div>
        )}
        {!playerId && nameFromUrl && (
          <div className="game-card p-6 text-center">
            <p className="text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
              Joining as {nameFromUrl}…
            </p>
          </div>
        )}

        {/* ── Lobby Waiting ── */}
        {phase === 'lobby' && playerId && (
          <div className="game-card p-6 text-center">
            <div className="mb-3 text-3xl">🎮</div>
            <h2
              className="text-lg font-bold text-white"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Waiting for host
            </h2>
            <p className="mt-2 text-sm" style={{ color: 'rgba(255,255,255,0.4)' }}>
              {room?.players.length ?? 0} player{(room?.players.length ?? 0) !== 1 ? 's' : ''} in
              lobby
            </p>
            <div className="mt-4 flex justify-center gap-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-1.5 w-1.5 animate-bounce rounded-full"
                  style={{ background: '#a78bfa', animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Wager Phase ── */}
        {isWager && wager && (
          <div className="game-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2
                  className="text-base font-bold text-white"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  🎰 High Stakes
                </h2>
                <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Risk your points. Win big or lose it all.
                </p>
              </div>
              <TimerRing
                seconds={wagerSecondsLeft}
                fraction={wagerSecondsLeft / 30}
                size={56}
                strokeWidth={4}
                color="#ec4899"
              >
                <span className="text-sm font-bold text-white tabular-nums">
                  {wagerSecondsLeft}
                </span>
              </TimerRing>
            </div>

            {/* Info card */}
            <div className="game-card-compact mb-4 p-4">
              <div className="text-sm font-semibold text-white">
                Category: <span style={{ color: '#f472b6' }}>{wager.category ?? '???'}</span>
              </div>
              <div className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Hint: {wager.hint ?? '???'}
              </div>
              {wagerExtraHint && (
                <div
                  className="mt-2 rounded-xl p-2.5 text-sm"
                  style={{
                    background: 'rgba(236,72,153,0.08)',
                    border: '1px solid rgba(236,72,153,0.15)',
                  }}
                >
                  <span className="font-bold" style={{ color: '#f472b6' }}>
                    🔥 Extra:
                  </span>{' '}
                  <span style={{ color: 'rgba(255,255,255,0.7)' }}>{wagerExtraHint}</span>
                </div>
              )}
            </div>

            <WagerStages currentIndex={wagerStageIndex} />
            {wagerNoDecreases && (
              <div
                className="mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
                style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
              >
                🚨 NO DECREASES
              </div>
            )}

            {me?.eliminated ? (
              <div className="game-card-compact mt-4 p-4 text-center">
                <span className="text-sm font-semibold" style={{ color: '#f87171' }}>
                  💀 Eliminated — no wagering
                </span>
              </div>
            ) : !wager.open ? (
              <div className="game-card-compact mt-4 p-4 text-center">
                <span className="text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>
                  🔒 Wagers locked — spotlight in progress
                </span>
              </div>
            ) : (
              <div className="mt-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">Your wager</span>
                  <span
                    className="text-lg font-black text-white tabular-nums"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {wagerAmount}
                  </span>
                </div>
                <input
                  className="wager-slider"
                  type="range"
                  min={0}
                  max={Math.max(0, me?.score ?? 0)}
                  step={10}
                  value={Math.min(wagerAmount, Math.max(0, me?.score ?? 0))}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    setWagerAmount((prev) => (wagerNoDecreases && next < prev ? prev : next));
                  }}
                  disabled={!me || !wager.open}
                />
                <div className="mt-3 flex gap-2">
                  {[0, 25, 50, 100].map((pct) => {
                    const max = Math.max(0, me?.score ?? 0);
                    const val = pct === 0 ? 0 : Math.floor((max * pct) / 100);
                    return (
                      <button
                        key={pct}
                        type="button"
                        className="game-card-compact flex-1 py-2.5 text-center text-xs font-bold text-white"
                        style={{ cursor: 'pointer', border: 'none' }}
                        onClick={() =>
                          setWagerAmount((prev) => (wagerNoDecreases && val < prev ? prev : val))
                        }
                        disabled={!me || !wager.open}
                      >
                        {pct === 0 ? '0' : `${pct}%`}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <WagerTierBadge tier={myTier} />
                  {myTierIndex >= 1 && (
                    <span className="text-[10px] font-bold" style={{ color: '#f472b6' }}>
                      🔥 Extra hint
                    </span>
                  )}
                  {myTierIndex >= 2 && (
                    <span className="text-[10px] font-bold" style={{ color: '#fbbf24' }}>
                      ✂️ Auto 50/50
                    </span>
                  )}
                  {myTier === 'ALL_IN' && (
                    <span className="text-[10px] font-bold" style={{ color: '#f87171' }}>
                      🔁 Final swap
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="cta-button mt-4"
                  style={{
                    background: 'linear-gradient(135deg, #db2777, #ec4899)',
                    boxShadow: '0 0 20px rgba(236,72,153,0.3), 0 8px 32px rgba(236,72,153,0.2)',
                  }}
                  disabled={!me || wagerSecondsLeft <= 0 || !wager.open}
                  onClick={() => submitWager(wagerAmount)}
                >
                  <span className="relative z-10">
                    {!wager.open ? 'Locked' : me?.wagerSubmitted ? 'Update Wager' : 'Place Wager'}
                  </span>
                </button>
                <div
                  className="mt-2 text-center text-[11px]"
                  style={{ color: 'rgba(255,255,255,0.3)' }}
                >
                  {me?.score ?? 0} points available · Pot: {wager.totalWagered}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── COUNTDOWN PHASE — Full-screen dramatic countdown ── */}
        {isCountdown && q && (
          <div className="game-card p-6">
            <div className="flex flex-col items-center py-6">
              <div
                className="countdown-number"
                key={countdownSecondsLeft}
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 900,
                  fontSize: 80,
                  background: 'linear-gradient(135deg, #7c3aed, #ec4899, #06b6d4)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  lineHeight: 1,
                }}
              >
                {countdownSecondsLeft || '🚀'}
              </div>
              <p className="mt-4 text-sm font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>
                {countdownSecondsLeft > 0 ? 'Get ready…' : 'Go!'}
              </p>
            </div>
            {/* Show question prompt during countdown (but answers hidden) */}
            <div className="game-card-compact mt-2 p-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.35)' }}>
                  {q.question.category} · {q.question.value} pts
                </span>
                {q.question.hard && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
                  >
                    HARD
                  </span>
                )}
              </div>
              <p className="text-base font-medium text-white">{q.question.prompt}</p>
            </div>
          </div>
        )}

        {/* ── QUESTION PHASE ── */}
        {q && !isCountdown && (
          <div className="game-card p-5">
            {/* Timer + Meta */}
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className="text-[11px] font-bold"
                    style={{ color: 'rgba(255,255,255,0.35)' }}
                  >
                    {q.question.category}
                  </span>
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: '#fbbf24' }}>
                    {q.question.value} pts
                  </span>
                  {q.question.hard && (
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                      style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
                    >
                      HARD
                    </span>
                  )}
                </div>
                {freezeBonusMs > 0 && (
                  <p className="text-[11px] font-semibold" style={{ color: '#60a5fa' }}>
                    ⏱️ +{freezeBonusMs / 1000}s bonus
                  </p>
                )}
                {speedBonusMax > 0 && isQuestionPhase && !q.locked && !me?.eliminated && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold" style={{ color: '#fbbf24' }}>
                      ⚡ Speed
                    </span>
                    <span
                      className="text-[11px] font-bold tabular-nums"
                      style={{
                        color: me?.lockedIn
                          ? '#4ade80'
                          : displaySpeedBonus > 0
                            ? '#fbbf24'
                            : 'rgba(255,255,255,0.25)',
                      }}
                    >
                      {me?.lockedIn
                        ? `🔒 +${displaySpeedBonus}`
                        : timeUp
                          ? '+0'
                          : `+${displaySpeedBonus}`}
                    </span>
                  </div>
                )}
              </div>
              <TimerRing seconds={secondsLeft} fraction={remainingFrac} size={64} strokeWidth={4} />
            </div>

            {/* Question Prompt */}
            <p className="text-base leading-relaxed font-semibold text-white">
              {q.question.prompt}
            </p>

            {/* Wager extra hints */}
            {currentAct?.id === 'wager_round' && wagerExtraHint && (
              <div
                className="mt-3 rounded-xl p-3 text-sm"
                style={{
                  background: 'rgba(236,72,153,0.08)',
                  border: '1px solid rgba(236,72,153,0.15)',
                }}
              >
                <span className="font-bold" style={{ color: '#f472b6' }}>
                  🔥 Extra hint:
                </span>{' '}
                <span style={{ color: 'rgba(255,255,255,0.7)' }}>{wagerExtraHint}</span>
              </div>
            )}
            {currentAct?.id === 'wager_round' && removedIndexes?.length ? (
              <div className="mt-2 text-[11px] font-bold" style={{ color: '#fbbf24' }}>
                ✂️ 50/50: 2 wrong answers removed
              </div>
            ) : null}

            {/* Blackout */}
            {isBlackout && (
              <div className="game-card-compact mt-3 p-3 text-center">
                <span className="text-sm font-bold" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  🕶️ Blackout! Choices in{' '}
                  <span className="tabular-nums">
                    {Math.max(0, Math.ceil((blackoutUntil - now) / 1000))}s
                  </span>
                </span>
              </div>
            )}

            {/* Reveal Feedback */}
            {q.locked && revealFeedback && (
              <div
                className="reveal-feedback game-card-compact mt-4 p-4"
                style={{
                  borderColor: revealFeedback.correct
                    ? 'rgba(34,197,94,0.3)'
                    : revealFeedback.yourAnswerIndex === null
                      ? 'rgba(255,255,255,0.1)'
                      : 'rgba(239,68,68,0.3)',
                  background: revealFeedback.correct
                    ? 'rgba(34,197,94,0.08)'
                    : revealFeedback.yourAnswerIndex === null
                      ? 'rgba(255,255,255,0.03)'
                      : 'rgba(239,68,68,0.08)',
                }}
              >
                <div
                  className="text-base font-bold"
                  style={{
                    color: revealFeedback.correct
                      ? '#4ade80'
                      : revealFeedback.yourAnswerIndex === null
                        ? 'rgba(255,255,255,0.5)'
                        : '#f87171',
                  }}
                >
                  {currentAct?.id === 'wager_round'
                    ? revealFeedback.correct
                      ? `🎰 WIN! +${revealFeedback.wagered ?? 0}`
                      : revealFeedback.yourAnswerIndex === null
                        ? '⏱️ No answer'
                        : `💸 LOST -${revealFeedback.wagered ?? 0}`
                    : revealFeedback.correct
                      ? `✅ Correct! +${revealFeedback.scoreDelta}`
                      : revealFeedback.yourAnswerIndex === null
                        ? '⏱️ No answer'
                        : '❌ Wrong'}
                  {revealFeedback.correct && revealFeedback.speedBonus
                    ? ` (⚡+${revealFeedback.speedBonus})`
                    : ''}
                </div>
                <div
                  className="mt-1 flex flex-wrap gap-2 text-[11px] font-semibold"
                  style={{ color: 'rgba(255,255,255,0.5)' }}
                >
                  {currentAct?.id !== 'wager_round' &&
                    !revealFeedback.heartsAtRisk &&
                    !revealFeedback.correct &&
                    revealFeedback.yourAnswerIndex !== null && (
                      <span style={{ color: '#4ade80' }}>🛡️ Safe round</span>
                    )}
                  {revealFeedback.shieldUsed && <span>🛡️ Shield</span>}
                  {revealFeedback.doublePointsUsed && <span>⭐ 2× Used</span>}
                  {revealFeedback.buybackUsed && <span>🪙 Buyback</span>}
                  {revealFeedback.livesDelta !== 0 && (
                    <span>{revealFeedback.livesDelta} lives</span>
                  )}
                  {revealFeedback.coinsDelta !== 0 && (
                    <span>+{revealFeedback.coinsDelta} coins</span>
                  )}
                </div>
              </div>
            )}

            {/* Answer Cards */}
            <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {q.question.choices.map((choice, i) => {
                const displayChoice = isBlackout ? '???' : choice;
                const isRemoved = removedIndexes?.includes(i);
                const isSelected = selectedAnswer === i;
                const showReveal = q.locked && typeof revealedCorrectIndex === 'number';
                const isCorrect = showReveal && i === revealedCorrectIndex;
                const yourIdx = revealFeedback?.yourAnswerIndex ?? selectedAnswer;
                const isYourPick = yourIdx === i;
                const isWrongPick = showReveal && isYourPick && !isCorrect;

                const cls = isRemoved
                  ? 'answer-removed'
                  : isCorrect
                    ? 'answer-correct'
                    : isWrongPick
                      ? 'answer-wrong'
                      : isSelected
                        ? 'answer-selected'
                        : '';

                return (
                  <button
                    key={i}
                    type="button"
                    disabled={
                      isCountdown ||
                      q.locked ||
                      isBlackout ||
                      timeUp ||
                      !!me?.eliminated ||
                      (!!me?.lockedIn && !canFinalSwap) ||
                      !!isRemoved
                    }
                    onClick={() => submitAnswer(i)}
                    className={`answer-card ${cls}`}
                  >
                    <div className="flex items-center">
                      <span className="answer-letter">{String.fromCharCode(65 + i)}</span>
                      <span className="flex-1">{displayChoice}</span>
                      {showReveal && isCorrect && <span className="ml-2 text-base">✓</span>}
                      {showReveal && isWrongPick && <span className="ml-2 text-base">✗</span>}
                      {!showReveal && isSelected && (
                        <span className="ml-2 text-xs" style={{ color: '#a78bfa' }}>
                          ●
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Lock In Bar */}
            {isQuestionPhase && !q.locked && !me?.eliminated && activeCount > 0 && (
              <div className="game-card-compact mt-4 flex items-center justify-between gap-3 p-3">
                <div>
                  <div
                    className="text-[11px] font-bold tabular-nums"
                    style={{ color: 'rgba(255,255,255,0.5)' }}
                  >
                    🔒 {lockedInCount}/{activeCount} locked
                  </div>
                  {isAllInCommitted && (
                    <div className="text-[10px] font-bold" style={{ color: '#f87171' }}>
                      {me?.wagerSwapUsed
                        ? '🔁 Swap used'
                        : me?.lockedIn
                          ? '🔁 Tap to swap once'
                          : '🟥 ALL IN: lock to unlock swap'}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={lockIn}
                  disabled={timeUp || !!me?.lockedIn || selectedAnswer === null}
                  className="host-btn host-btn-violet"
                  style={{ padding: '10px 18px', fontSize: 11 }}
                >
                  {me?.lockedIn ? '✅ Locked' : '🔒 Lock In'}
                </button>
              </div>
            )}

            {/* Active Items */}
            {isQuestionPhase && activeItems.length > 0 && currentAct?.id !== 'wager_round' && (
              <div className="mt-3 flex flex-wrap gap-2">
                {activeItems.map(([itemId, count]) => (
                  <button
                    key={itemId}
                    type="button"
                    disabled={q.locked || timeUp || !!me?.eliminated || !!me?.lockedIn}
                    onClick={() => handleUseItem(itemId)}
                    className="game-card-compact px-3 py-2 text-[11px] font-bold text-white"
                    style={{ cursor: 'pointer', border: 'none' }}
                  >
                    {ITEM_META[itemId].emoji} {ITEM_META[itemId].name}
                    {count > 1 && ` ×${count}`}
                  </button>
                ))}
              </div>
            )}

            {/* Status text */}
            <p className="mt-3 text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>
              {q.locked
                ? 'Answer revealed.'
                : timeUp
                  ? "Time's up — waiting for reveal…"
                  : me?.lockedIn
                    ? canFinalSwap
                      ? '🔁 Tap one answer to swap'
                      : '🔒 Locked — waiting for reveal…'
                    : selectedAnswer === null
                      ? 'Tap an answer to select it.'
                      : `Selected ${String.fromCharCode(65 + selectedAnswer)} — change or lock in.`}
            </p>
          </div>
        )}

        {/* ── Eliminated ── */}
        {me?.eliminated && (
          <div className="game-card p-5" style={{ borderColor: 'rgba(239,68,68,0.15)' }}>
            <div className="mb-3 flex items-center gap-3">
              <span className="text-2xl">💀</span>
              <div>
                <h2
                  className="text-base font-bold"
                  style={{ fontFamily: 'var(--font-display)', color: '#f87171' }}
                >
                  Eliminated
                </h2>
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                  Buy back in or request a revive
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {shopOpen && (
                <button type="button" onClick={doBuyback} className="host-btn host-btn-red">
                  🪙 Buyback ({room?.config.buybackCostCoins} coins)
                </button>
              )}
              {canRequestRevive && (
                <button type="button" onClick={requestRevive} className="host-btn host-btn-green">
                  🙏 Request Revive
                </button>
              )}
              {isBossAct && (
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
                  Revive unavailable during Boss Fight
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Shop ── */}
        {shopOpen && (
          <div className="game-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2
                className="text-base font-bold text-white"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                🛒 Shop
              </h2>
              <span className="stat-pill stat-pill-coins">
                <span style={{ fontSize: 12 }}>🪙</span>
                <span className="tabular-nums">{me?.coins ?? 0}</span>
              </span>
            </div>
            <div className="space-y-2.5">
              {(room?.shop?.items ?? []).map((item) => (
                <div key={item.id} className="shop-item flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">{ITEM_META[item.id]?.emoji}</span>
                      <span className="text-sm font-semibold text-white">{item.name}</span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                        style={{
                          background:
                            item.kind === 'passive'
                              ? 'rgba(34,197,94,0.1)'
                              : 'rgba(245,158,11,0.1)',
                          color: item.kind === 'passive' ? '#4ade80' : '#fbbf24',
                        }}
                      >
                        {item.kind === 'passive' ? 'AUTO' : 'USE'}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                      {item.description}
                    </div>
                    <div className="mt-0.5 text-[11px] font-bold" style={{ color: '#c084fc' }}>
                      🪙 {item.cost}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={(me?.coins ?? 0) < item.cost}
                    onClick={() => buyItem(item.id)}
                    className="host-btn host-btn-violet"
                    style={{ padding: '8px 16px', fontSize: 11 }}
                  >
                    Buy
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Inventory (non-shop) ── */}
        {!shopOpen && (passiveItems.length > 0 || activeItems.length > 0) && (
          <div className="game-card-compact p-4">
            <div
              className="mb-2 text-[10px] font-bold tracking-wider uppercase"
              style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-display)' }}
            >
              Inventory
            </div>
            <div className="flex flex-wrap gap-2">
              {passiveItems.map(([itemId, count]) => (
                <span
                  key={itemId}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
                  style={{
                    background: 'rgba(34,197,94,0.08)',
                    border: '1px solid rgba(34,197,94,0.15)',
                    color: '#4ade80',
                  }}
                >
                  {ITEM_META[itemId].emoji} {ITEM_META[itemId].name}
                  {count > 1 && ` ×${count}`}
                </span>
              ))}
              {activeItems.map(([itemId, count]) => (
                <span
                  key={itemId}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold"
                  style={{
                    background: 'rgba(245,158,11,0.08)',
                    border: '1px solid rgba(245,158,11,0.15)',
                    color: '#fbbf24',
                  }}
                >
                  {ITEM_META[itemId].emoji} {ITEM_META[itemId].name}
                  {count > 1 && ` ×${count}`}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── Final Results ── */}
        {phase === 'ended' &&
          (room?.players.length ?? 0) > 0 &&
          (() => {
            const sorted = [...(room?.players ?? [])].sort((a, b) => b.score - a.score);
            const podium = sorted.slice(0, 3);
            const medals = ['🥇', '🥈', '🥉'];
            const myRank = sorted.findIndex((p) => p.playerId === playerId);
            return (
              <div className="game-card p-6">
                <h2
                  className="mb-5 text-center text-xl font-bold text-white"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  🏆 Game Over!
                </h2>

                {/* Podium */}
                <div className="flex items-end justify-center gap-3">
                  {podium.map((p, i) => {
                    const heights = [140, 110, 90];
                    const gradients = [
                      'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.05))',
                      'linear-gradient(135deg, rgba(148,163,184,0.12), rgba(148,163,184,0.04))',
                      'linear-gradient(135deg, rgba(234,88,12,0.12), rgba(234,88,12,0.04))',
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
                        className={`podium-${i === 0 ? '1st' : i === 1 ? '2nd' : '3rd'} flex flex-col items-center rounded-2xl p-3`}
                        style={{
                          order: order[i],
                          minWidth: i === 0 ? 100 : 85,
                          height: heights[i],
                          background: gradients[i],
                          border: `1px solid ${borders[i]}`,
                          justifyContent: 'center',
                        }}
                      >
                        <span className="text-2xl">{medals[i]}</span>
                        <span className="mt-1 max-w-full truncate text-xs font-bold text-white">
                          {p.name}
                          {p.playerId === playerId && ' (you)'}
                        </span>
                        <span
                          className="mt-0.5 text-lg font-black tabular-nums"
                          style={{ fontFamily: 'var(--font-display)', color: '#fbbf24' }}
                        >
                          {p.score}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Your stats */}
                {me && (
                  <div className="game-card-compact mt-5 p-4 text-center">
                    <p className="text-sm font-semibold text-white">
                      You finished{' '}
                      <span
                        className="text-lg font-black"
                        style={{ color: '#a78bfa', fontFamily: 'var(--font-display)' }}
                      >
                        #{myRank + 1}
                      </span>{' '}
                      of {sorted.length}
                    </p>
                    <div
                      className="mt-2 flex justify-center gap-4 text-sm"
                      style={{ color: 'rgba(255,255,255,0.6)' }}
                    >
                      <span>★ {me.score}</span>
                      <span>🪙 {me.coins}</span>
                      <span>♥ {me.lives}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

        {/* ── Scoreboard ── */}
        <div className="game-card-compact p-4">
          <div
            className="mb-3 text-[10px] font-bold tracking-wider uppercase"
            style={{ color: 'rgba(255,255,255,0.3)', fontFamily: 'var(--font-display)' }}
          >
            Scoreboard
          </div>
          <div className="space-y-1.5">
            {[...(room?.players ?? [])]
              .sort((a, b) => b.score - a.score)
              .map((p, rank) => (
                <PlayerRow
                  key={p.playerId}
                  name={`${rank + 1}. ${p.name}`}
                  lives={p.lives}
                  score={p.score}
                  coins={p.coins}
                  connected={p.connected}
                  eliminated={p.eliminated}
                  isMe={p.playerId === playerId}
                  lockedIn={p.lockedIn}
                  buffs={p.buffs}
                  hasBuyback={(p.inventory['buyback_token'] ?? 0) > 0}
                />
              ))}
          </div>
        </div>
      </div>
    </main>
  );
}
