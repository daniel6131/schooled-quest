import { logger } from '@/lib/logger';
import {
  getDefaultPackId,
  getPackQuestions,
  hasAnyPacks,
  listPacks,
  loadQuestionPacks,
} from '@/lib/questionLoader';
import express from 'express';
import { createServer } from 'http';
import { customAlphabet, nanoid } from 'nanoid';
import next from 'next';
import os from 'os';
import { Server } from 'socket.io';

/* ────────────────────── Types ────────────────────── */

type Phase =
  | 'lobby'
  | 'wager'
  | 'countdown'
  | 'question'
  | 'reveal'
  | 'shop'
  | 'boss'
  | 'intermission'
  | 'ended';
type ActId = 'homeroom' | 'pop_quiz' | 'field_trip' | 'wager_round' | 'boss_fight';

type WagerStage = 'blind' | 'category' | 'hint' | 'redline' | 'closing' | 'locked';
type WagerTier = 'SAFE' | 'BOLD' | 'HIGH_ROLLER' | 'INSANE' | 'ALL_IN';
type WagerSpotlightEntry = {
  playerId: string;
  name: string;
  wager: number;
  score: number;
  ratio: number;
  tier: WagerTier;
};
type WagerSpotlightPayload = {
  totalWagered: number;
  allInCount: number;
  noBetCount: number;
  biggest?: WagerSpotlightEntry;
  topRisk: WagerSpotlightEntry[];
};

type ActConfig = {
  id: ActId;
  name: string;
  emoji: string;
  description: string;
  questionDurationMs: number;
  heartsAtRisk: boolean;
  heartsOnlyOnHard: boolean;
  coinRewardBase: number;
  scoreMultiplier: number;
  /** Which shop items are available for purchase during this act's shop windows */
  availableShopItems: ShopItemId[];
  /** Max speed bonus points for an instant lock-in (scales linearly with time remaining) */
  speedBonusMax: number;
};

type Player = {
  playerId: string;
  socketId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;

  lives: number;
  score: number;
  coins: number;
  eliminated: boolean;

  lockedIn: boolean;

  inventory: Record<string, number>;

  // Wager round state (only meaningful during wager_round act)
  wager?: number;
  wagerSubmitted?: boolean;
  wagerSwapUsed?: boolean;

  buffs: {
    doublePoints: boolean;
    shield: boolean;
  };
};

type PublicPlayer = Omit<Player, 'socketId'>;

type Question = {
  id: string;
  category: string;
  prompt: string;
  hint?: string;
  extraHint?: string;
  choices: string[];
  answerIndex: number;
  value: number;
  /** Whether this is a "hard" question — matters in acts with heartsOnlyOnHard */
  hard?: boolean;
};

type PublicQuestion = Omit<Question, 'answerIndex'>;

type RoomConfig = {
  maxLives: number;
  questionDurationMs: number;
  countdownMs: number;
  startingCoins: number;
  buybackCostCoins: number;
  bossHp: number;
};

type CurrentQuestion = {
  questionId: string;
  /** When the countdown ends and the question timer starts */
  countdownEndsAt?: number;
  startedAt: number;
  endsAt: number;
  /** If set, choices are hidden/disabled until this timestamp (wager_round twist) */
  blackoutUntil?: number;
  answersByPlayerId: Map<string, number>;
  /** Timestamp when each player locked in (used for speed bonus calculation) */
  lockinTimeByPlayerId: Map<string, number>;
  freezeBonus: Map<string, number>;
  locked: boolean;
  forcedRevealAt?: number;
};

type BossState = {
  hp: number;
  maxHp: number;
  questionIds: string[];
  currentQuestionId?: string;
  startedAt: number;
};

type ShopItemId = 'double_points' | 'shield' | 'buyback_token' | 'fifty_fifty' | 'freeze_time';

type ShopItem = {
  id: ShopItemId;
  name: string;
  cost: number;
  description: string;
  kind: 'passive' | 'active';
};

type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

type ReviveRequest = {
  playerId: string;
  playerName: string;
  requestedAt: number;
};

type PublicRoomState = {
  code: string;
  createdAt: number;
  phase: Phase;
  config: RoomConfig;
  players: PublicPlayer[];
  currentQuestion?: {
    question: PublicQuestion;
    /** When the countdown finishes and the question timer starts */
    countdownEndsAt?: number;
    startedAt: number;
    endsAt: number;
    revealAt: number;
    blackoutUntil?: number;
    locked: boolean;
    revealedAnswerIndex?: number;
  };
  wager?: {
    open: boolean;
    endsAt: number;
    locked: boolean;
    stage: WagerStage;
    noDecreases: boolean;
    category?: string;
    hint?: string;
    totalWagered: number;
  };
  shop?: { open: boolean; items: ShopItem[] };
  boss?: BossState;
  remainingQuestions: number;
  currentAct?: {
    id: ActId;
    name: string;
    emoji: string;
    description: string;
    heartsAtRisk: boolean;
    questionNumber: number;
    totalQuestions: number;
    speedBonusMax: number;
  };
};

type HostRoomState = {
  code: string;
  phase: Phase;
  hostKey: string;
  currentAnswerIndex?: number;
  correctChoice?: string;
  questionDebug?: Question;
  currentAct?: {
    id: ActId;
    name: string;
    emoji: string;
    questionNumber: number;
    totalQuestions: number;
    heartsAtRisk: boolean;
  };
  availableActs?: ActId[];
  wager?: {
    open: boolean;
    endsAt: number;
    locked: boolean;
    stage: WagerStage;
    noDecreases: boolean;
    category?: string;
    hint?: string;
    totalWagered: number;
  };
  /** If set, a player is requesting to be revived and host must approve/decline */
  pendingRevive?: ReviveRequest;
};

type PlayerRevealPayload = {
  questionId: string;
  correctAnswerIndex: number;
  yourAnswerIndex: number | null;
  correct: boolean;
  scoreDelta: number;
  coinsDelta: number;
  livesDelta: number;
  eliminated: boolean;
  shieldUsed?: boolean;
  doublePointsUsed?: boolean;
  buybackUsed?: boolean;
  heartsAtRisk?: boolean;
  /** Speed bonus points earned (0 if not locked in or wrong) */
  speedBonus?: number;
  /** Wager amount (only for wager_round) */
  wagered?: number;
};

type ItemUseAckData =
  | { itemId: 'fifty_fifty'; room: PublicRoomState; removedIndexes: number[] }
  | { itemId: 'freeze_time'; room: PublicRoomState; bonusMs: number }
  | { itemId: Exclude<ShopItemId, 'fifty_fifty' | 'freeze_time'>; room: PublicRoomState };

/* ────────────────────── Config ────────────────────── */

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

const makeCode = customAlphabet('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 5);

const DEFAULT_CONFIG: RoomConfig = {
  maxLives: 3,
  questionDurationMs: 25_000, // fallback, acts override this
  countdownMs: 3_000, // 3-2-1 countdown before each question
  startingCoins: 150,
  buybackCostCoins: 200,
  bossHp: 6,
};

/* ────────────────────── Act Definitions ────────────────────── */

const ACT_CONFIGS: Record<ActId, ActConfig> = {
  homeroom: {
    id: 'homeroom',
    name: 'Homeroom',
    emoji: '🏫',
    description: 'Warm up! No hearts at risk. Build your score and earn starter gold.',
    questionDurationMs: 22_000, // 20-25s range, we pick 22s
    heartsAtRisk: false,
    heartsOnlyOnHard: false,
    coinRewardBase: 50, // generous starter coins
    scoreMultiplier: 1.0,
    // Act 1: only basic active items — let players learn the ropes
    availableShopItems: ['fifty_fifty', 'freeze_time', 'double_points'],
    speedBonusMax: 20, // small bonus — warm-up, keep it chill
  },
  pop_quiz: {
    id: 'pop_quiz',
    name: 'Pop Quiz',
    emoji: '📝',
    description: 'Things heat up. Hard questions cost hearts!',
    questionDurationMs: 27_000,
    heartsAtRisk: false, // base is safe
    heartsOnlyOnHard: true, // only hard questions cost hearts
    coinRewardBase: 40,
    scoreMultiplier: 1.0,
    // Act 2: introduce Shield + Buyback now that hearts can be lost on hard Qs
    availableShopItems: ['fifty_fifty', 'freeze_time', 'double_points', 'shield', 'buyback_token'],
    speedBonusMax: 30,
  },
  field_trip: {
    id: 'field_trip',
    name: 'Field Trip',
    emoji: '🎒',
    description: 'Wrong answers cost hearts. Buyback becomes your best friend.',
    questionDurationMs: 30_000,
    heartsAtRisk: true,
    heartsOnlyOnHard: false,
    coinRewardBase: 35,
    scoreMultiplier: 1.5,
    // Act 3: everything available
    availableShopItems: ['fifty_fifty', 'freeze_time', 'double_points', 'shield', 'buyback_token'],
    speedBonusMax: 40,
  },
  wager_round: {
    id: 'wager_round',
    name: 'High Stakes',
    emoji: '🎰',
    description:
      'Everyone still alive can wager points. Get it right: win your wager. Get it wrong: lose it.',
    // High Stakes should feel dramatic: significantly more thinking time.
    // Requested: ~1 minute or more for the High Stakes question.
    questionDurationMs: 75_000,
    // No hearts at risk — this round is about points
    heartsAtRisk: false,
    heartsOnlyOnHard: false,
    // No coin rewards here — keep the focus on score swings
    coinRewardBase: 0,
    // Score multiplier does not apply — wager is handled specially
    scoreMultiplier: 1.0,
    // No shop items during High Stakes
    availableShopItems: [],
    speedBonusMax: 0,
  },
  boss_fight: {
    id: 'boss_fight',
    name: 'Boss Fight',
    emoji: '🐉',
    description: 'The final showdown. Escalating points, hearts on the line.',
    questionDurationMs: 30_000,
    heartsAtRisk: true,
    heartsOnlyOnHard: false,
    coinRewardBase: 30,
    scoreMultiplier: 2.0,
    // Act 4: everything available
    availableShopItems: ['fifty_fifty', 'freeze_time', 'double_points', 'shield', 'buyback_token'],
    speedBonusMax: 60, // big reward for fast answers in the finale
  },
};

const ACT_ORDER: ActId[] = ['homeroom', 'pop_quiz', 'field_trip', 'wager_round', 'boss_fight'];

/* ────────────────────── Question Bank (per act) ────────────────────── */

/**
 * Get questions for an act from the room's selected question pack.
 * Falls back to empty array if pack or act not found.
 */
function getActQuestions(room: Room, actId: ActId): Question[] {
  return getPackQuestions(room.packId, actId);
}

/* ────────────────────── Shop Items ────────────────────── */

const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'fifty_fifty',
    name: '50/50',
    cost: 80,
    description: 'Remove 2 wrong answers during a question',
    kind: 'active',
  },
  {
    id: 'freeze_time',
    name: 'Freeze Time',
    cost: 70,
    description: '+10 seconds on the current question',
    kind: 'active',
  },
  {
    id: 'double_points',
    name: 'Double Points',
    cost: 100,
    description: 'Next correct answer scores 2×. Auto-triggers.',
    kind: 'passive',
  },
  {
    id: 'shield',
    name: 'Shield',
    cost: 100,
    description: 'Negates next heart loss. Auto-triggers.',
    kind: 'passive',
  },
  {
    id: 'buyback_token',
    name: 'Buyback Token',
    cost: 120,
    description: 'Auto-revives you with 1 life if eliminated.',
    kind: 'passive',
  },
];

/* ────────────────────── Room ────────────────────── */

type ActState = {
  actId: ActId;
  config: ActConfig;
  questions: Question[];
  questionIndex: number;
};

type WagerState = {
  questionId: string;
  startedAt: number;
  endsAt: number;
  stage: WagerStage;
  locked: boolean;
  wagersByPlayerId: Map<string, number>;
  /** Per-player 50/50 perk (generated once when wagers lock) */
  removedIndexesByPlayerId: Map<string, number[]>;
  /** Timers for the redline timeline */
  stageTimers?: {
    category?: ReturnType<typeof setTimeout>;
    hint?: ReturnType<typeof setTimeout>;
    redline?: ReturnType<typeof setTimeout>;
    closing?: ReturnType<typeof setTimeout>;
    lock?: ReturnType<typeof setTimeout>;
    postLock?: ReturnType<typeof setTimeout>;
  };
};

type Room = {
  code: string;
  createdAt: number;
  lastActivityAt: number;
  hostKey: string;
  hostSocketId: string | null;
  phase: Phase;
  config: RoomConfig;
  packId: string;
  playersById: Map<string, Player>;
  socketToPlayerId: Map<string, string>;

  /** The current act state — null only during lobby */
  actState: ActState | null;

  /** Wager mini-round state (used only during wager_round act) */
  wagerState?: WagerState;

  /** Legacy fields kept for boss mode compatibility */
  questionDeck: Question[];
  questionIndex: number;
  currentQuestion?: CurrentQuestion;
  shopOpen: boolean;
  boss?: BossState;
  /** Active revive request awaiting host decision */
  pendingRevive?: ReviveRequest;
  /** Timer handle for the countdown→question transition */
  countdownTimer?: ReturnType<typeof setTimeout>;
};

const rooms = new Map<string, Room>();

/**
 * Reverse lookup: socketId → room code.
 * Avoids iterating all rooms on every disconnect.
 */
const socketToRoomCode = new Map<string, string>();

/** How long a room can be idle before it's cleaned up (ms) */
const ROOM_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours
/** How often to run the cleanup sweep (ms) */
const ROOM_CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

/** Update room's last activity timestamp */
function touchRoom(room: Room) {
  room.lastActivityAt = Date.now();
}

/** Remove a room and clean up all related socket mappings */
function destroyRoom(code: string) {
  const room = rooms.get(code);
  if (!room) return;

  // Clear pending countdown timer
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = undefined;
  }

  // Clear wager timers
  if (room.wagerState?.stageTimers) {
    for (const key of Object.keys(room.wagerState.stageTimers) as (keyof NonNullable<
      WagerState['stageTimers']
    >)[]) {
      const t = room.wagerState.stageTimers[key];
      if (t) clearTimeout(t);
    }
    room.wagerState.stageTimers = {};
  }

  // Clean up reverse lookup for all sockets in this room
  for (const socketId of room.socketToPlayerId.keys()) {
    socketToRoomCode.delete(socketId);
  }
  if (room.hostSocketId) {
    socketToRoomCode.delete(room.hostSocketId);
  }

  rooms.delete(code);
  logger.info({ code, playerCount: room.playersById.size }, 'room destroyed (cleanup)');
}

/** Periodic sweep: remove idle/ended rooms */
function cleanupRooms() {
  const now = Date.now();
  let cleaned = 0;
  for (const [code, room] of rooms) {
    const idle = now - room.lastActivityAt;

    // Remove ended rooms after 10 minutes
    if (room.phase === 'ended' && idle > 10 * 60 * 1000) {
      destroyRoom(code);
      cleaned++;
      continue;
    }

    // Remove rooms idle for too long
    if (idle > ROOM_IDLE_TIMEOUT_MS) {
      destroyRoom(code);
      cleaned++;
      continue;
    }

    // Remove rooms where everyone disconnected and nobody came back in 15 min
    const anyoneConnected =
      room.hostSocketId !== null || Array.from(room.playersById.values()).some((p) => p.connected);
    if (!anyoneConnected && idle > 15 * 60 * 1000) {
      destroyRoom(code);
      cleaned++;
      continue;
    }
  }
  if (cleaned > 0) {
    logger.info({ cleaned, remaining: rooms.size }, 'room cleanup sweep');
  }
}

/* ────────────────────── Helpers ────────────────────── */

function getLanIPv4(): string | null {
  const nets = os.networkInterfaces();
  for (const group of Object.values(nets)) {
    for (const net of group ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toPublicPlayer(p: Player): PublicPlayer {
  const inv = p.inventory ?? {};

  return {
    playerId: p.playerId,
    name: p.name,
    isHost: p.isHost,
    connected: p.connected,
    joinedAt: p.joinedAt,

    lives: p.lives,
    score: p.score,
    coins: p.coins,
    eliminated: p.eliminated,

    lockedIn: p.lockedIn,

    inventory: inv,

    wager: p.wager,
    wagerSubmitted: p.wagerSubmitted,
    wagerSwapUsed: p.wagerSwapUsed,

    buffs: {
      doublePoints: (inv.double_points ?? 0) > 0,
      shield: (inv.shield ?? 0) > 0,
    },
  };
}

function getCurrentQuestion(room: Room): Question | undefined {
  if (!room.currentQuestion) return undefined;

  // First check act questions
  if (room.actState) {
    return room.actState.questions.find((q) => q.id === room.currentQuestion?.questionId);
  }

  // Fallback to legacy deck
  return room.questionDeck.find((q) => q.id === room.currentQuestion?.questionId);
}

function activePlayersForQuestion(room: Room): Player[] {
  return Array.from(room.playersById.values()).filter((p) => p.connected && !p.eliminated);
}

function computeRevealAt(room: Room): number {
  if (!room.currentQuestion) return 0;
  const baseEndsAt = room.currentQuestion.endsAt;
  if (room.currentQuestion.forcedRevealAt) return room.currentQuestion.forcedRevealAt;

  let maxEndsAt = baseEndsAt;
  const active = activePlayersForQuestion(room);
  for (const p of active) {
    const bonus = room.currentQuestion.freezeBonus.get(p.playerId) || 0;
    maxEndsAt = Math.max(maxEndsAt, baseEndsAt + bonus);
  }
  return maxEndsAt;
}

/**
 * A player counts as "done" for a question if they either:
 * - Explicitly locked in, OR
 * - Their personal timer has expired (base + any freeze bonus)
 *
 * This matters when some players have freeze_time bonus:
 * Player A (no bonus) times out → they're "done"
 * Player B (freeze bonus) still has time → NOT done yet
 * → We should NOT force-close until Player B also finishes.
 */
function isPlayerDoneForQuestion(p: Player, room: Room): boolean {
  if (p.lockedIn) return true;
  if (!room.currentQuestion) return true;

  const bonusMs = room.currentQuestion.freezeBonus.get(p.playerId) || 0;
  const playerEndsAt = room.currentQuestion.endsAt + bonusMs;
  return Date.now() >= playerEndsAt;
}

function allActivePlayersDone(room: Room): boolean {
  const active = activePlayersForQuestion(room);
  if (active.length === 0) return false;
  return active.every((p) => isPlayerDoneForQuestion(p, room));
}

function maybeForceCloseIfAllLocked(room: Room) {
  if (!room.currentQuestion) return;
  if (room.currentQuestion.locked) return;
  if (room.phase !== 'question' && room.phase !== 'boss') return;
  if (room.currentQuestion.forcedRevealAt) return;

  if (allActivePlayersDone(room)) {
    room.currentQuestion.forcedRevealAt = Date.now();
    logger.info(`  🔒 All active players done — question ended early in room ${room.code}`);
  }
}

function toPublicQuestion(q: Question): PublicQuestion {
  return {
    id: q.id,
    category: q.category,
    prompt: q.prompt,
    hint: q.hint,
    choices: q.choices,
    value: q.value,
    hard: q.hard,
  };
}

/** Get the effective timer duration for the current question */
function getQuestionDurationMs(room: Room): number {
  if (room.actState) {
    return room.actState.config.questionDurationMs;
  }
  return room.config.questionDurationMs;
}

/** Check whether the current question costs hearts when answered wrong */
function doesQuestionCostHearts(room: Room, question: Question): boolean {
  if (!room.actState) return true; // legacy behavior: always costs hearts

  const act = room.actState.config;

  // Act says no hearts at risk at all
  if (!act.heartsAtRisk && !act.heartsOnlyOnHard) return false;

  // Act says only hard questions cost hearts
  if (act.heartsOnlyOnHard) return !!question.hard;

  // Act says all wrong answers cost hearts
  return act.heartsAtRisk;
}

function getActRemainingQuestions(room: Room): number {
  if (room.actState) {
    return Math.max(0, room.actState.questions.length - room.actState.questionIndex);
  }
  return Math.max(0, room.questionDeck.length - room.questionIndex);
}

/** Get the shop items available for the current act (progressive unlock) */
function getShopItemsForAct(room: Room): ShopItem[] {
  if (!room.actState) return SHOP_ITEMS; // fallback: all items
  const allowed = room.actState.config.availableShopItems;
  return SHOP_ITEMS.filter((item) => allowed.includes(item.id));
}

function roomToPublic(room: Room): PublicRoomState {
  const players = Array.from(room.playersById.values())
    .map(toPublicPlayer)
    .sort((a, b) => a.joinedAt - b.joinedAt);

  const q = getCurrentQuestion(room);
  const wagerQ =
    room.wagerState && room.actState
      ? room.actState.questions.find((qq) => qq.id === room.wagerState?.questionId)
      : undefined;

  const actInfo = room.actState
    ? {
        id: room.actState.actId,
        name: room.actState.config.name,
        emoji: room.actState.config.emoji,
        description: room.actState.config.description,
        heartsAtRisk: room.actState.config.heartsAtRisk || room.actState.config.heartsOnlyOnHard,
        questionNumber: room.actState.questionIndex,
        totalQuestions: room.actState.questions.length,
        speedBonusMax: room.actState.config.speedBonusMax,
      }
    : undefined;

  return {
    code: room.code,
    createdAt: room.createdAt,
    phase: room.phase,
    config: room.config,
    players,
    currentQuestion:
      q && room.currentQuestion
        ? {
            question: toPublicQuestion(q),
            countdownEndsAt: room.currentQuestion.countdownEndsAt,
            startedAt: room.currentQuestion.startedAt,
            endsAt: room.currentQuestion.endsAt,
            locked: room.currentQuestion.locked,
            revealAt: computeRevealAt(room),
            blackoutUntil: room.currentQuestion.blackoutUntil,
            revealedAnswerIndex: room.currentQuestion.locked ? q.answerIndex : undefined,
          }
        : undefined,
    wager:
      room.wagerState && wagerQ
        ? (() => {
            const stage = room.wagerState!.stage;
            const idx = wagerStageIndex(stage);
            return {
              open: room.phase === 'wager' && !room.wagerState!.locked,
              endsAt: room.wagerState!.endsAt,
              locked: room.wagerState!.locked,
              stage,
              noDecreases: idx >= 3,
              category: idx >= 1 ? wagerQ.category : undefined,
              hint: idx >= 2 ? wagerQ.hint : undefined,
              totalWagered: Array.from(room.wagerState!.wagersByPlayerId.values()).reduce(
                (sum, v) => sum + v,
                0
              ),
            };
          })()
        : undefined,
    shop: {
      open: room.shopOpen,
      items: getShopItemsForAct(room),
    },
    boss: room.boss,
    remainingQuestions: getActRemainingQuestions(room),
    currentAct: actInfo,
  };
}

function getAvailableActs(room: Room): ActId[] {
  // Only show next-act options during intermission (after finishing an act's questions)
  if (!room.actState) {
    // In lobby, the only option is to start homeroom (handled by game:start)
    return [];
  }

  // Only show act transitions during intermission
  if (room.phase !== 'intermission') return [];

  const currentIdx = ACT_ORDER.indexOf(room.actState.actId);
  return ACT_ORDER.slice(currentIdx + 1);
}

function roomToHost(room: Room): HostRoomState {
  const q = getCurrentQuestion(room);
  const wagerQ =
    room.wagerState && room.actState
      ? room.actState.questions.find((qq) => qq.id === room.wagerState?.questionId)
      : undefined;
  return {
    code: room.code,
    phase: room.phase,
    hostKey: room.hostKey,
    currentAnswerIndex: q ? q.answerIndex : undefined,
    correctChoice: q ? q.choices[q.answerIndex] : undefined,
    questionDebug: q,
    currentAct: room.actState
      ? {
          id: room.actState.actId,
          name: room.actState.config.name,
          emoji: room.actState.config.emoji,
          questionNumber: room.actState.questionIndex,
          totalQuestions: room.actState.questions.length,
          heartsAtRisk: room.actState.config.heartsAtRisk || room.actState.config.heartsOnlyOnHard,
        }
      : undefined,
    availableActs: getAvailableActs(room),
    wager:
      room.wagerState && wagerQ
        ? (() => {
            const stage = room.wagerState!.stage;
            const idx = wagerStageIndex(stage);
            return {
              open: room.phase === 'wager' && !room.wagerState!.locked,
              endsAt: room.wagerState!.endsAt,
              locked: room.wagerState!.locked,
              stage,
              noDecreases: idx >= 3,
              category: wagerQ.category,
              hint: wagerQ.hint,
              totalWagered: Array.from(room.wagerState!.wagersByPlayerId.values()).reduce(
                (sum, v) => sum + v,
                0
              ),
            };
          })()
        : undefined,
    pendingRevive: room.pendingRevive,
  };
}

function broadcastRoom(io: Server, room: Room) {
  touchRoom(room);
  io.to(room.code).emit('room:state', roomToPublic(room));
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit('host:state', roomToHost(room));
  }
}

function requireRoom(code: string): Room {
  const room = rooms.get(code);
  if (!room) throw new Error('Room not found.');
  return room;
}

function requireHost(room: Room, hostKey: string) {
  if (!hostKey || hostKey !== room.hostKey) throw new Error('Not authorized (hostKey).');
}

function requirePlayer(room: Room, playerId: string): Player {
  const p = room.playersById.get(playerId);
  if (!p) throw new Error('Player not found.');
  return p;
}

function nextQuestion(room: Room): Question | null {
  if (room.actState) {
    if (room.actState.questionIndex >= room.actState.questions.length) return null;
    const q = room.actState.questions[room.actState.questionIndex];
    room.actState.questionIndex += 1;
    return q;
  }

  // Legacy fallback
  if (room.questionIndex >= room.questionDeck.length) return null;
  const q = room.questionDeck[room.questionIndex];
  room.questionIndex += 1;
  return q;
}

function startQuestion(
  room: Room,
  q: Question,
  io: Server,
  opts?: { durationOverrideMs?: number; blackoutUntil?: number }
) {
  const now = Date.now();
  const durationMs = opts?.durationOverrideMs ?? getQuestionDurationMs(room);
  const countdownMs = room.config.countdownMs;
  const countdownEndsAt = now + countdownMs;

  // Reset per-question flags
  for (const p of room.playersById.values()) {
    p.lockedIn = false;
  }

  // Clear any existing countdown timer
  if (room.countdownTimer) {
    clearTimeout(room.countdownTimer);
    room.countdownTimer = undefined;
  }

  // Phase starts as countdown — question timer begins after countdown
  room.phase = 'countdown';
  room.currentQuestion = {
    questionId: q.id,
    countdownEndsAt,
    startedAt: countdownEndsAt, // timer starts when countdown ends
    endsAt: countdownEndsAt + durationMs,
    blackoutUntil: opts?.blackoutUntil,
    answersByPlayerId: new Map(),
    lockinTimeByPlayerId: new Map(),
    freezeBonus: new Map(),
    locked: false,
    forcedRevealAt: undefined,
  };

  // Auto-transition to question/boss phase when countdown ends
  room.countdownTimer = setTimeout(() => {
    room.countdownTimer = undefined;
    // Guard: only transition if still in countdown for this question
    if (room.phase !== 'countdown') return;
    if (room.currentQuestion?.questionId !== q.id) return;

    room.phase = room.boss ? 'boss' : 'question';
    broadcastRoom(io, room);
    logger.info(`  ▶ Countdown finished — question live in room ${room.code}`);
  }, countdownMs);
}

function wagerStageIndex(stage: WagerStage): number {
  switch (stage) {
    case 'blind':
      return 0;
    case 'category':
      return 1;
    case 'hint':
      return 2;
    case 'redline':
      return 3;
    case 'closing':
      return 4;
    case 'locked':
      return 5;
    default:
      return 0;
  }
}

function computeWagerTier(
  score: number,
  wager: number
): { tier: WagerTier; ratio: number; index: number } {
  const s = Math.max(0, Math.floor(score));
  const w = Math.max(0, Math.floor(wager));
  if (s <= 0 || w <= 0) return { tier: 'SAFE', ratio: 0, index: 0 };
  const ratioRaw = w / s;
  const ratio = Math.max(0, Math.min(1, ratioRaw));

  if (w >= s) return { tier: 'ALL_IN', ratio: 1, index: 4 };
  if (ratio >= 0.8) return { tier: 'INSANE', ratio, index: 3 };
  if (ratio >= 0.5) return { tier: 'HIGH_ROLLER', ratio, index: 2 };
  if (ratio >= 0.25) return { tier: 'BOLD', ratio, index: 1 };
  return { tier: 'SAFE', ratio, index: 0 };
}

function clearWagerTimers(room: Room) {
  const st = room.wagerState?.stageTimers;
  if (!st) return;
  for (const key of Object.keys(st) as (keyof NonNullable<WagerState['stageTimers']>)[]) {
    const t = st[key];
    if (t) clearTimeout(t);
  }
  room.wagerState!.stageTimers = {};
}

function sendWagerPerksIfNeeded(room: Room, p: Player, io: Server) {
  if (room.actState?.actId !== 'wager_round') return;
  const ws = room.wagerState;
  if (!ws) return;
  const q = room.actState?.questions.find((qq) => qq.id === ws.questionId);
  if (!q) return;

  // Extra hint unlocks at REDLINE for Bold+
  if (room.phase === 'wager' && wagerStageIndex(ws.stage) >= 3 && !p.eliminated) {
    const w = ws.wagersByPlayerId.get(p.playerId) ?? p.wager ?? 0;
    const tier = computeWagerTier(p.score, w);
    if (tier.index >= 1) {
      const text = (
        q.extraHint && q.extraHint.trim().length > 0
          ? q.extraHint.trim()
          : 'Trust your logic — eliminate what cannot be true.'
      ) as string;
      io.to(p.socketId).emit('wager:extra_hint', { text });
    }
  }

  // 50/50 perk for High Roller+ (generated when wagers lock)
  if (room.currentQuestion && room.currentQuestion.questionId === ws.questionId) {
    const removed = ws.removedIndexesByPlayerId.get(p.playerId);
    if (removed && removed.length > 0) {
      io.to(p.socketId).emit('wager:fifty_fifty', { removedIndexes: removed });
    }
  }
}

function startWager(room: Room, q: Question, io: Server) {
  const now = Date.now();
  // Requested: ~1 minute to choose wager.
  const wagerMs = 60_000;

  // Redline timeline beats (ms after start)
  const categoryOffset = 15_000; // 45s left
  const hintOffset = 30_000; // 30s left
  const redlineOffset = 45_000; // 15s left (NO DECREASES)
  const closingOffset = 55_000; // 5s left (siren)

  // Reset per-player wager state
  for (const p of room.playersById.values()) {
    p.wager = undefined;
    p.wagerSubmitted = false;
    p.wagerSwapUsed = undefined;
  }

  // Clear any old wager timers
  if (room.wagerState?.stageTimers) clearWagerTimers(room);

  room.phase = 'wager';
  room.currentQuestion = undefined;
  room.shopOpen = false;

  room.wagerState = {
    questionId: q.id,
    startedAt: now,
    endsAt: now + wagerMs,
    stage: 'blind',
    locked: false,
    wagersByPlayerId: new Map(),
    removedIndexesByPlayerId: new Map(),
    stageTimers: {},
  };

  const ws = room.wagerState;

  ws.stageTimers!.category = setTimeout(() => {
    if (!room.wagerState || room.wagerState.questionId !== q.id) return;
    if (room.wagerState.locked) return;
    room.wagerState.stage = 'category';
    broadcastRoom(io, room);
  }, categoryOffset);

  ws.stageTimers!.hint = setTimeout(() => {
    if (!room.wagerState || room.wagerState.questionId !== q.id) return;
    if (room.wagerState.locked) return;
    room.wagerState.stage = 'hint';
    broadcastRoom(io, room);
  }, hintOffset);

  ws.stageTimers!.redline = setTimeout(() => {
    if (!room.wagerState || room.wagerState.questionId !== q.id) return;
    if (room.wagerState.locked) return;
    room.wagerState.stage = 'redline';

    // Unlock extra hint for Bold+ immediately (private per player)
    for (const p of room.playersById.values()) {
      if (!p.connected || p.eliminated) continue;
      sendWagerPerksIfNeeded(room, p, io);
    }

    broadcastRoom(io, room);
  }, redlineOffset);

  ws.stageTimers!.closing = setTimeout(() => {
    if (!room.wagerState || room.wagerState.questionId !== q.id) return;
    if (room.wagerState.locked) return;
    room.wagerState.stage = 'closing';
    io.to(room.code).emit('wager:siren');
    broadcastRoom(io, room);
  }, closingOffset);

  ws.stageTimers!.lock = setTimeout(() => {
    lockWagers(room, io);
  }, wagerMs);

  logger.info({ code: room.code }, '🎰 wager phase started (redline)');
}

function lockWagers(room: Room, io: Server) {
  const ws = room.wagerState;
  if (!ws) return;
  if (ws.locked) return;
  const q = room.actState?.questions.find((qq) => qq.id === ws.questionId);
  if (!q) return;

  ws.locked = true;
  ws.stage = 'locked';

  // Stop timeline timers
  if (ws.stageTimers) {
    for (const key of Object.keys(ws.stageTimers) as (keyof NonNullable<
      WagerState['stageTimers']
    >)[]) {
      const t = ws.stageTimers[key];
      if (t) clearTimeout(t);
    }
    ws.stageTimers = {};
  }

  // Compute spotlight + perks
  const alive = Array.from(room.playersById.values()).filter((p) => !p.eliminated);
  const entries: WagerSpotlightEntry[] = [];
  let totalWagered = 0;
  let allInCount = 0;
  let noBetCount = 0;

  for (const p of alive) {
    const beforeScore = Math.max(0, p.score);
    const rawW = ws.wagersByPlayerId.get(p.playerId) ?? 0;
    const wager = Math.max(0, Math.min(Math.floor(rawW), beforeScore));
    totalWagered += wager;

    if (wager <= 0) noBetCount++;

    const tier = computeWagerTier(beforeScore, wager);
    if (tier.tier === 'ALL_IN') allInCount++;

    if (wager > 0) {
      entries.push({
        playerId: p.playerId,
        name: p.name,
        wager,
        score: beforeScore,
        ratio: tier.ratio,
        tier: tier.tier,
      });
    }

    // Reset swap for upcoming question
    p.wagerSwapUsed = false;

    // Pre-generate 50/50 perk for High Roller+ (stored so reconnects get same removal)
    if (tier.index >= 2) {
      const wrong = q.choices.map((_, idx) => idx).filter((idx) => idx !== q.answerIndex);
      const removed = shuffle(wrong).slice(0, 2);
      ws.removedIndexesByPlayerId.set(p.playerId, removed);
    }
  }

  // Biggest bet / top risk takers
  const sorted = [...entries].sort((a, b) => {
    if (b.ratio !== a.ratio) return b.ratio - a.ratio;
    return b.wager - a.wager;
  });

  const spotlight: WagerSpotlightPayload = {
    totalWagered,
    allInCount,
    noBetCount,
    biggest: sorted[0],
    topRisk: sorted.slice(0, 3),
  };

  io.to(room.code).emit('wager:spotlight', spotlight);
  broadcastRoom(io, room);

  // ✅ Host-controlled: the spotlight stays up until the host triggers wager:spotlight_end.
  // The wager question will start when the host ends the spotlight.
}

/** Start a new act: loads its questions and resets act-level state */
function startAct(room: Room, actId: ActId) {
  const config = ACT_CONFIGS[actId];
  let questions = shuffle(getActQuestions(room, actId));

  // High Stakes is a single dramatic round before the boss
  if (actId === 'wager_round' && questions.length > 1) {
    questions = questions.slice(0, 1);
  }

  room.actState = {
    actId,
    config,
    questions,
    questionIndex: 0,
  };

  room.currentQuestion = undefined;
  room.shopOpen = false;

  logger.info(
    `  ${config.emoji} Act started: ${config.name} (${questions.length} questions) in room ${room.code}`
  );
}

function armPassiveBuff(p: Player, itemId: ShopItemId) {
  if (itemId === 'double_points') p.buffs.doublePoints = true;
  if (itemId === 'shield') p.buffs.shield = true;
}

/**
 * Core scoring + passive item auto-trigger logic.
 * Now act-aware: respects heartsAtRisk / heartsOnlyOnHard rules.
 */
function revealAndScore(room: Room): Map<string, PlayerRevealPayload> {
  const q = getCurrentQuestion(room);
  if (!q || !room.currentQuestion) return new Map();

  room.currentQuestion.locked = true;
  room.phase = 'reveal';

  const isWagerRound = room.actState?.actId === 'wager_round';
  const heartsAtRisk = isWagerRound ? false : doesQuestionCostHearts(room, q);
  const actConfig = room.actState?.config;
  const scoreMultiplier = actConfig?.scoreMultiplier ?? 1.0;
  const coinRewardBase = actConfig?.coinRewardBase ?? Math.floor(q.value / 2);
  const speedBonusMax = actConfig?.speedBonusMax ?? 0;
  const questionDurationMs = actConfig?.questionDurationMs ?? room.config.questionDurationMs;

  const results = new Map<string, PlayerRevealPayload>();

  for (const p of room.playersById.values()) {
    const beforeScore = p.score;
    const beforeCoins = p.coins;
    const beforeLives = p.lives;
    const wasEliminated = p.eliminated;

    const ans = room.currentQuestion.answersByPlayerId.get(p.playerId);
    const answered = typeof ans === 'number';
    const correct = answered && ans === q.answerIndex;

    let shieldUsed = false;
    let doublePointsUsed = false;
    let buybackUsed = false;
    let speedBonus = 0;

    if (!wasEliminated) {
      // ───────────────── Wager Round Scoring ─────────────────
      if (isWagerRound && room.wagerState) {
        const rawWager = room.wagerState.wagersByPlayerId.get(p.playerId) ?? 0;
        const wager = Math.max(0, Math.min(Math.floor(rawWager), beforeScore));
        const scoreDelta = correct ? wager : -wager;
        p.score = Math.max(0, p.score + scoreDelta);

        results.set(p.playerId, {
          questionId: q.id,
          correctAnswerIndex: q.answerIndex,
          yourAnswerIndex: answered ? (ans as number) : null,
          correct: !!correct,
          scoreDelta: p.score - beforeScore,
          coinsDelta: 0,
          livesDelta: 0,
          eliminated: p.eliminated,
          heartsAtRisk: false,
          wagered: wager || undefined,
        });
        continue;
      }

      if (correct) {
        // ── Speed Bonus (only if locked in) ──
        const lockinTime = room.currentQuestion.lockinTimeByPlayerId.get(p.playerId);
        if (lockinTime && speedBonusMax > 0) {
          const elapsed = lockinTime - room.currentQuestion.startedAt;
          const fractionRemaining = Math.max(0, 1 - elapsed / questionDurationMs);
          speedBonus = Math.floor(speedBonusMax * fractionRemaining);
        }

        // ── Double Points (passive auto-trigger) ──
        let multiplier = 1;
        if (p.buffs.doublePoints) {
          multiplier = 2;
          doublePointsUsed = true;
          p.buffs.doublePoints = false;
          const count = p.inventory['double_points'] || 0;
          if (count > 0) p.inventory['double_points'] = count - 1;
          logger.info(`  🌟 ${p.name}: double points consumed`);
        }

        const scoreDelta = Math.floor(q.value * scoreMultiplier * multiplier) + speedBonus;
        p.score += scoreDelta;
        p.coins += coinRewardBase;

        if (room.boss) {
          room.boss.hp = Math.max(0, room.boss.hp - 1);
        }
      } else {
        // ── Heart Loss Logic (act-aware) ──
        if (heartsAtRisk) {
          // Shield check
          if (p.buffs.shield) {
            shieldUsed = true;
            p.buffs.shield = false;
            const count = p.inventory['shield'] || 0;
            if (count > 0) p.inventory['shield'] = count - 1;
            logger.info(`  🛡️ ${p.name}: shield absorbed the hit`);
          } else {
            p.lives -= 1;
            if (p.lives <= 0) {
              p.lives = 0;

              // Buyback Token check
              const tokenCount = p.inventory['buyback_token'] || 0;
              if (tokenCount > 0) {
                buybackUsed = true;
                p.inventory['buyback_token'] = tokenCount - 1;
                p.lives = 1;
                p.eliminated = false;
                logger.info(`  🪙 ${p.name}: buyback token auto-revived`);
              } else {
                p.eliminated = true;
                logger.info(`  💀 ${p.name}: eliminated`);
              }
            }
          }
        }
        // If hearts NOT at risk: no heart loss at all (Act 1 behavior)
      }
    }

    results.set(p.playerId, {
      questionId: q.id,
      correctAnswerIndex: q.answerIndex,
      yourAnswerIndex: answered ? (ans as number) : null,
      correct: !!correct,
      scoreDelta: p.score - beforeScore,
      coinsDelta: p.coins - beforeCoins,
      livesDelta: p.lives - beforeLives,
      eliminated: p.eliminated,
      shieldUsed: shieldUsed || undefined,
      doublePointsUsed: doublePointsUsed || undefined,
      buybackUsed: buybackUsed || undefined,
      heartsAtRisk,
      speedBonus: speedBonus || undefined,
    });
  }

  return results;
}

function openShop(room: Room, open: boolean) {
  room.shopOpen = open;
  room.phase = open ? 'shop' : 'reveal';
}

function maybeEnd(room: Room) {
  const alive = Array.from(room.playersById.values()).filter((p) => !p.eliminated);
  if (alive.length === 0) room.phase = 'ended';
  if (room.boss && room.boss.hp <= 0) room.phase = 'ended';
}

/** Check if the current act is finished (all questions answered) */
function isActFinished(room: Room): boolean {
  if (!room.actState) return true;
  return room.actState.questionIndex >= room.actState.questions.length;
}

/* ────────────────────── Main ────────────────────── */

async function main() {
  // Load question packs before anything else
  const packCount = loadQuestionPacks();
  if (packCount === 0) {
    logger.error(
      'No question packs loaded — the game will not work. Add .json packs to data/question-packs/'
    );
  }

  await nextApp.prepare();
  const app = express();
  const httpServer = createServer(app);
  const port = Number(process.env.PORT || 3000);

  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    pingTimeout: 60_000,
    pingInterval: 25_000,
  });

  // ── Rate limiting middleware ──
  const RATE_LIMIT_WINDOW_MS = 1_000; // 1 second window
  const RATE_LIMIT_MAX_EVENTS = 20; // max events per window
  const socketEventCounts = new Map<string, { count: number; resetAt: number }>();

  io.use((socket, next) => {
    socket.onAny(() => {
      const now = Date.now();
      let entry = socketEventCounts.get(socket.id);
      if (!entry || now >= entry.resetAt) {
        entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
        socketEventCounts.set(socket.id, entry);
      }
      entry.count++;
      if (entry.count > RATE_LIMIT_MAX_EVENTS) {
        logger.warn({ socketId: socket.id }, 'rate limit exceeded — disconnecting');
        socket.disconnect(true);
      }
    });
    next();
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'socket connected');

    socket.onAny((event) => {
      logger.info('event', event, 'from', socket.id);
    });

    // Clean up rate limit entry on disconnect
    socket.on('disconnect', () => {
      socketEventCounts.delete(socket.id);
    });

    /* ── Room: Create ── */
    socket.on(
      'room:create',
      (
        payload: { hostName: string; packId?: string },
        ack: (res: Ack<{ room: PublicRoomState; hostKey: string }>) => void
      ) => {
        try {
          const hostName = (payload?.hostName || '').trim().slice(0, 20);
          if (!hostName) return ack({ ok: false, error: 'Host name is required.' });

          if (!hasAnyPacks()) return ack({ ok: false, error: 'No question packs loaded.' });

          const packId = (payload?.packId || '').trim() || getDefaultPackId();
          if (!packId) return ack({ ok: false, error: 'No question pack available.' });

          let code = makeCode();
          for (let i = 0; i < 10 && rooms.has(code); i++) code = makeCode();

          const hostKey = nanoid(24);

          const room: Room = {
            code,
            createdAt: Date.now(),
            lastActivityAt: Date.now(),
            hostKey,
            hostSocketId: socket.id,
            phase: 'lobby',
            config: { ...DEFAULT_CONFIG },
            packId,
            playersById: new Map(),
            socketToPlayerId: new Map(),
            actState: null,
            questionDeck: [],
            questionIndex: 0,
            currentQuestion: undefined,
            shopOpen: false,
            boss: undefined,
            pendingRevive: undefined,
          };

          rooms.set(code, room);
          socketToRoomCode.set(socket.id, code);
          socket.join(code);
          logger.info(`Room ${code} created by host "${hostName}" (pack: ${packId})`);

          ack({ ok: true, data: { room: roomToPublic(room), hostKey } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Room: Join ── */
    socket.on(
      'room:join',
      (
        payload: { code: string; name: string },
        ack: (res: Ack<{ room: PublicRoomState; playerId: string }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const name = (payload?.name || '').trim().slice(0, 20);
          if (!code) return ack({ ok: false, error: 'Room code is required.' });
          if (!name) return ack({ ok: false, error: 'Name is required.' });

          const room = requireRoom(code);

          // ── Join guards ──
          const MAX_PLAYERS = 30;
          if (room.playersById.size >= MAX_PLAYERS) {
            return ack({ ok: false, error: `Room is full (max ${MAX_PLAYERS} players).` });
          }

          if (room.phase !== 'lobby') {
            return ack({
              ok: false,
              error: 'Game already in progress. Ask the host to let you in.',
            });
          }

          const nameLower = name.toLowerCase();
          const nameTaken = Array.from(room.playersById.values()).some(
            (p) => p.name.toLowerCase() === nameLower
          );
          if (nameTaken) {
            return ack({
              ok: false,
              error: `"${name}" is already taken. Choose a different name.`,
            });
          }

          const playerId = nanoid(12);
          const p: Player = {
            playerId,
            socketId: socket.id,
            name,
            isHost: false,
            connected: true,
            joinedAt: Date.now(),
            lives: room.config.maxLives,
            score: 0,
            coins: room.config.startingCoins,
            eliminated: false,
            inventory: {},
            lockedIn: false,
            buffs: { doublePoints: false, shield: false },
          };

          room.playersById.set(playerId, p);
          room.socketToPlayerId.set(socket.id, playerId);
          socketToRoomCode.set(socket.id, code);
          socket.join(code);
          touchRoom(room);

          ack({ ok: true, data: { room: roomToPublic(room), playerId } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Room: Resume ── */
    socket.on(
      'room:resume',
      (
        payload: { code: string; playerId?: string; hostKey?: string },
        ack: (res: Ack<{ room: PublicRoomState; isHost: boolean }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const playerId = (payload?.playerId || '').trim();
          const hostKey = (payload?.hostKey || '').trim();
          if (!code) return ack({ ok: false, error: 'Room code is required.' });

          const room = requireRoom(code);

          if (hostKey) {
            requireHost(room, hostKey);
            room.hostSocketId = socket.id;
            socketToRoomCode.set(socket.id, code);
            socket.join(code);
            touchRoom(room);
            ack({ ok: true, data: { room: roomToPublic(room), isHost: true } });
            broadcastRoom(io, room);
            return;
          }

          if (!playerId) return ack({ ok: false, error: 'playerId is required.' });

          const p = requirePlayer(room, playerId);
          p.socketId = socket.id;
          p.connected = true;
          room.socketToPlayerId.set(socket.id, playerId);
          socketToRoomCode.set(socket.id, code);
          socket.join(code);
          touchRoom(room);
          sendWagerPerksIfNeeded(room, p, io);

          ack({ ok: true, data: { room: roomToPublic(room), isHost: false } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Room: Watch (spectators / pre-join) ── */
    socket.on(
      'room:watch',
      (payload: { code: string }, ack: (res: Ack<{ room: PublicRoomState }>) => void) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          if (!code) return ack({ ok: false, error: 'Room code is required.' });
          const room = requireRoom(code);
          socket.join(code);
          ack({ ok: true, data: { room: roomToPublic(room) } });
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Room: Leave ── */
    socket.on('room:leave', (payload: { code: string; playerId?: string }) => {
      const code = (payload?.code || '').trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) return;
      const playerId = payload?.playerId || room.socketToPlayerId.get(socket.id);
      if (playerId) {
        const p = room.playersById.get(playerId);
        if (p) p.connected = false;
      }
      room.socketToPlayerId.delete(socket.id);
      socketToRoomCode.delete(socket.id);
      socket.leave(code);
      maybeEnd(room);
      broadcastRoom(io, room);
    });

    /* ── Game: Configure ── */
    socket.on(
      'game:configure',
      (
        payload: { code: string; hostKey: string; config: Partial<RoomConfig> },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());
          room.config = { ...room.config, ...(payload?.config || {}) };
          for (const p of room.playersById.values()) {
            if (p.lives > room.config.maxLives) p.lives = room.config.maxLives;
          }
          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Act: Start ──
     * Host starts a specific act. This loads that act's questions and begins the first one.
     * Can be used from lobby (to start Act 1) or from reveal/shop (to advance to next act).
     */
    socket.on(
      'act:start',
      (
        payload: { code: string; hostKey: string; actId: ActId },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());
          const actId = payload?.actId;

          if (!ACT_CONFIGS[actId]) throw new Error('Invalid act.');

          // Can only advance to next act from intermission (or shop during intermission)
          if (room.actState) {
            if (room.phase !== 'intermission' && room.phase !== 'shop') {
              throw new Error('Finish the current act first before starting the next one.');
            }
          }

          // Validate act ordering (can only go forward or restart)
          if (room.actState) {
            const currentIdx = ACT_ORDER.indexOf(room.actState.actId);
            const targetIdx = ACT_ORDER.indexOf(actId);
            if (targetIdx <= currentIdx) {
              throw new Error(`Cannot go back to ${ACT_CONFIGS[actId].name}. Only forward.`);
            }
          }

          startAct(room, actId);

          // Boss Fight needs boss state so the room enters 'boss' phase
          if (actId === 'boss_fight') {
            room.boss = {
              hp: room.config.bossHp,
              maxHp: room.config.bossHp,
              questionIds: room.actState!.questions.map((qq) => qq.id),
              startedAt: Date.now(),
            };
          } else {
            room.boss = undefined;
          }

          // Auto-start the first question
          const q = nextQuestion(room);
          if (!q) throw new Error('No questions available for this act.');
          if (actId === 'wager_round') {
            startWager(room, q, io);
          } else {
            startQuestion(room, q, io);
          }

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Game: Start (legacy — starts Act 1 Homeroom by default) ── */
    socket.on(
      'game:start',
      (
        payload: { code: string; hostKey: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());

          room.shopOpen = false;

          // If no act is active, start Act 1 (Homeroom)
          if (!room.actState) {
            startAct(room, 'homeroom');
          }

          const q = nextQuestion(room);
          if (!q) throw new Error('No questions available.');
          startQuestion(room, q, io);

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Wager: Set (players place/change wager) ── */
    socket.on(
      'wager:set',
      (
        payload: { code: string; playerId: string; amount: number },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          const p = requirePlayer(room, (payload?.playerId || '').trim());
          const amount = Number(payload?.amount);

          if (room.phase !== 'wager' || !room.wagerState || room.wagerState.locked) {
            throw new Error('Wagers are not open.');
          }
          if (Date.now() > room.wagerState.endsAt) throw new Error('Wager time is up.');
          if (p.eliminated) throw new Error('You are eliminated.');

          let wager =
            Number.isFinite(amount) && amount > 0
              ? Math.min(Math.floor(amount), Math.max(0, p.score))
              : 0;

          // REDLINE: once we hit redline/closing, wagers can only increase or hold.
          const prev = room.wagerState.wagersByPlayerId.get(p.playerId) ?? 0;
          if (wagerStageIndex(room.wagerState.stage) >= 3 && wager < prev) {
            wager = prev;
          }

          room.wagerState.wagersByPlayerId.set(p.playerId, wager);
          p.wager = wager;
          p.wagerSubmitted = true;

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Wager: Lock (host can lock wagers early) ── */
    socket.on(
      'wager:lock',
      (
        payload: { code: string; hostKey: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());

          if (room.phase !== 'wager' || !room.wagerState) throw new Error('Not in wager phase.');
          lockWagers(room, io);

          ack({ ok: true, data: { room: roomToPublic(room) } });
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );
    /* ── Wager: Spotlight End (host controls when the spotlight finishes) ── */
    socket.on(
      'wager:spotlight_end',
      (
        payload: { code: string; hostKey: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());

          const ws = room.wagerState;
          if (room.phase !== 'wager' || !ws) throw new Error('Not in wager spotlight.');
          if (!ws.locked || ws.stage !== 'locked') throw new Error('Spotlight is not active.');
          if (room.currentQuestion) throw new Error('Wager question already started.');

          const q = room.actState?.questions.find((qq) => qq.id === ws.questionId);
          if (!q) throw new Error('Wager question not found.');

          // Start the wager question with the act's longer timer
          startQuestion(room, q, io, {
            durationOverrideMs: ACT_CONFIGS.wager_round.questionDurationMs,
          });

          // Deliver per-player perks (50/50, extra hint if applicable) now that the question exists
          for (const p of room.playersById.values()) {
            if (!p.connected) continue;
            sendWagerPerksIfNeeded(room, p, io);
          }

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Question: Reveal ── */
    socket.on(
      'question:reveal',
      (
        payload: { code: string; hostKey: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());

          if (!room.currentQuestion) throw new Error('No active question.');
          if (room.phase !== 'question' && room.phase !== 'boss') {
            throw new Error('Not in a revealable phase.');
          }
          if (room.currentQuestion.locked) throw new Error('Already revealed.');

          const revealAt = computeRevealAt(room);
          if (Date.now() < revealAt) throw new Error('Players are still answering.');
          const results = revealAndScore(room);
          maybeEnd(room);

          // Private per-player feedback on reveal
          for (const p of room.playersById.values()) {
            const payload = results.get(p.playerId);
            if (!payload) continue;
            io.to(p.socketId).emit('player:reveal', payload);
          }

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Question: Next ── */
    socket.on(
      'question:next',
      (
        payload: { code: string; hostKey: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());

          room.currentQuestion = undefined;
          room.shopOpen = false;
          // Clear wager state between questions
          room.wagerState = undefined;
          for (const p of room.playersById.values()) {
            p.wager = undefined;
            p.wagerSubmitted = false;
            p.wagerSwapUsed = undefined;
          }

          if (room.boss && room.boss.hp <= 0) {
            room.phase = 'ended';
            ack({ ok: true, data: { room: roomToPublic(room) } });
            broadcastRoom(io, room);
            return;
          }

          const q = nextQuestion(room);
          if (!q) {
            // Act is finished — go to intermission so host can open shop or start next act
            if (room.actState) {
              room.phase = 'intermission';
              logger.info(`  🏁 Act "${room.actState.config.name}" finished in room ${room.code}`);
              ack({ ok: true, data: { room: roomToPublic(room) } });
              broadcastRoom(io, room);
              return;
            }
            room.phase = 'ended';
            ack({ ok: true, data: { room: roomToPublic(room) } });
            broadcastRoom(io, room);
            return;
          }

          if (room.actState?.actId === 'wager_round') {
            startWager(room, q, io);
          } else {
            startQuestion(room, q, io);
          }
          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Shop: Open / Close ── */
    socket.on(
      'shop:open',
      (
        payload: { code: string; hostKey: string; open: boolean },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());
          const open = !!payload?.open;

          if (
            open &&
            room.phase !== 'reveal' &&
            room.phase !== 'shop' &&
            room.phase !== 'intermission'
          ) {
            throw new Error(
              'Shop can only be opened after revealing an answer or during intermission.'
            );
          }

          openShop(room, open);
          // If we were in intermission and closing the shop, go back to intermission
          if (!open && room.actState && isActFinished(room)) {
            room.phase = 'intermission';
          }
          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Shop: Buy ── */
    socket.on(
      'shop:buy',
      (
        payload: { code: string; playerId: string; itemId: ShopItemId },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          const p = requirePlayer(room, (payload?.playerId || '').trim());
          const itemId = payload?.itemId;

          if (!room.shopOpen) throw new Error('Shop is closed.');

          const item = SHOP_ITEMS.find((i) => i.id === itemId);
          if (!item) throw new Error('Invalid item.');

          // Check item is available in the current act
          const availableItems = getShopItemsForAct(room);
          if (!availableItems.find((i) => i.id === itemId)) {
            throw new Error(`${item.name} is not available in this act.`);
          }

          if (p.coins < item.cost) throw new Error('Not enough coins.');

          p.coins -= item.cost;
          p.inventory[item.id] = (p.inventory[item.id] || 0) + 1;

          if (item.kind === 'passive') {
            armPassiveBuff(p, item.id);
          }

          logger.info(`  ${p.name} bought ${item.name} (${item.kind})`);

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Item: Use (active items only) ── */
    socket.on(
      'item:use',
      (
        payload: { code: string; playerId: string; itemId: ShopItemId },
        ack: (res: Ack<ItemUseAckData>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          const p = requirePlayer(room, (payload?.playerId || '').trim());
          const itemId = payload?.itemId;

          const item = SHOP_ITEMS.find((i) => i.id === itemId);
          if (!item) throw new Error('Invalid item.');
          if (item.kind !== 'active')
            throw new Error(`${item.name} is passive — it triggers automatically.`);

          const count = p.inventory[itemId] || 0;
          if (count <= 0) throw new Error('You do not own this item.');

          if (room.phase !== 'question' && room.phase !== 'boss') {
            throw new Error('Active items can only be used during a question.');
          }

          if (room.actState?.actId === 'wager_round') {
            throw new Error('No items during High Stakes.');
          }

          const q = getCurrentQuestion(room);
          if (!q || !room.currentQuestion) throw new Error('No active question.');

          if (room.currentQuestion.locked) throw new Error('Question is locked.');
          if (p.eliminated) throw new Error('You are eliminated.');
          const isWagerRound = (room.actState?.actId as string) === 'wager_round';
          const ws = room.wagerState;
          const rawWager = ws ? (ws.wagersByPlayerId.get(p.playerId) ?? p.wager ?? 0) : 0;
          const tier = computeWagerTier(p.score, rawWager);
          const canFinalSwap =
            isWagerRound && tier.tier === 'ALL_IN' && p.lockedIn && !p.wagerSwapUsed;
          if (p.lockedIn && !canFinalSwap) throw new Error('Answer locked in.');

          const bonusMs = room.currentQuestion.freezeBonus.get(p.playerId) || 0;
          const playerEndsAt = room.currentQuestion.endsAt + bonusMs;
          const revealAt = computeRevealAt(room);
          const effectiveEndsAt = Math.min(playerEndsAt, revealAt);
          if (Date.now() > effectiveEndsAt) throw new Error('Time is up.');

          if (itemId === 'fifty_fifty') {
            p.inventory[itemId] = count - 1;
            const wrong = q.choices.map((_, idx) => idx).filter((idx) => idx !== q.answerIndex);
            const removed = shuffle(wrong).slice(0, 2);
            logger.info(`  ✂️ ${p.name} used 50/50, removed indexes: ${removed}`);

            ack({ ok: true, data: { itemId, room: roomToPublic(room), removedIndexes: removed } });
            broadcastRoom(io, room);
            return;
          }

          if (itemId === 'freeze_time') {
            p.inventory[itemId] = count - 1;
            const bonusMs = 10_000;
            const existing = room.currentQuestion.freezeBonus.get(p.playerId) || 0;
            room.currentQuestion.freezeBonus.set(p.playerId, existing + bonusMs);
            logger.info(`  ⏱️ ${p.name} used Freeze Time (+${bonusMs / 1000}s)`);

            ack({ ok: true, data: { itemId, room: roomToPublic(room), bonusMs } });
            broadcastRoom(io, room);
            return;
          }

          throw new Error('Unhandled active item.');
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Player: Answer ── */
    socket.on(
      'player:answer',
      (
        payload: { code: string; playerId: string; answerIndex: number },
        ack: (res: Ack<{ accepted: boolean }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          const p = requirePlayer(room, (payload?.playerId || '').trim());
          const answerIndex = Number(payload?.answerIndex);

          if (!room.currentQuestion) throw new Error('No active question.');
          if (room.phase !== 'question' && room.phase !== 'boss') {
            throw new Error('Not accepting answers right now.');
          }
          if (room.currentQuestion.locked) throw new Error('Question is locked.');
          if (p.eliminated) throw new Error('You are eliminated.');
          const isWagerRound = room.actState?.actId === 'wager_round';
          const ws = room.wagerState;
          const rawWager = ws ? (ws.wagersByPlayerId.get(p.playerId) ?? p.wager ?? 0) : 0;
          const tier = computeWagerTier(p.score, rawWager);
          const canFinalSwap =
            isWagerRound && tier.tier === 'ALL_IN' && p.lockedIn && !p.wagerSwapUsed;
          if (p.lockedIn && !canFinalSwap) throw new Error('Answer locked in.');

          const q = getCurrentQuestion(room);
          if (!q) throw new Error('Question not found.');
          const bonusMs = room.currentQuestion.freezeBonus.get(p.playerId) || 0;
          const playerEndsAt = room.currentQuestion.endsAt + bonusMs;
          const revealAt = computeRevealAt(room);
          const effectiveEndsAt = Math.min(playerEndsAt, revealAt);
          if (Date.now() > effectiveEndsAt) throw new Error('Time is up.');

          if (!Number.isFinite(answerIndex) || answerIndex < 0 || answerIndex >= q.choices.length) {
            throw new Error('Invalid answer.');
          }

          room.currentQuestion.answersByPlayerId.set(p.playerId, answerIndex);

          // High Stakes perk: ALL IN gets one final swap after lock-in
          if (canFinalSwap) {
            p.wagerSwapUsed = true;
            logger.info(`  🔁 ${p.name} used Final Swap (${room.code})`);
          }

          ack({ ok: true, data: { accepted: true } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Player: Lock In ── */
    socket.on(
      'player:lockin',
      (
        payload: { code: string; playerId: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          const p = requirePlayer(room, (payload?.playerId || '').trim());

          if (!room.currentQuestion) throw new Error('No active question.');
          if (room.phase !== 'question' && room.phase !== 'boss') {
            throw new Error('Not accepting lock-ins right now.');
          }
          if (room.currentQuestion.locked) throw new Error('Question is locked.');
          if (p.eliminated) throw new Error('You are eliminated.');

          const q = getCurrentQuestion(room);
          if (!q) throw new Error('Question not found.');

          const bonusMs = room.currentQuestion.freezeBonus.get(p.playerId) || 0;
          const playerEndsAt = room.currentQuestion.endsAt + bonusMs;
          const revealAt = computeRevealAt(room);
          const effectiveEndsAt = Math.min(playerEndsAt, revealAt);
          if (Date.now() > effectiveEndsAt) throw new Error('Time is up.');

          const ans = room.currentQuestion.answersByPlayerId.get(p.playerId);
          if (typeof ans !== 'number') throw new Error('Pick an answer before locking in.');

          p.lockedIn = true;
          room.currentQuestion.lockinTimeByPlayerId.set(p.playerId, Date.now());
          logger.info(`  🔒 ${p.name} locked in (${room.code})`);

          maybeForceCloseIfAllLocked(room);

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Player: Buyback (manual coin buyback) ── */
    socket.on(
      'player:buyback',
      (
        payload: { code: string; playerId: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          const p = requirePlayer(room, (payload?.playerId || '').trim());

          if (!p.eliminated) throw new Error('You are not eliminated.');
          if (p.coins < room.config.buybackCostCoins)
            throw new Error('Not enough coins for buyback.');

          p.coins -= room.config.buybackCostCoins;
          p.eliminated = false;
          p.lives = 1;

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Boss: Start ── */
    socket.on(
      'boss:start',
      (
        payload: { code: string; hostKey: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());

          // Start the boss_fight act
          startAct(room, 'boss_fight');

          room.boss = {
            hp: room.config.bossHp,
            maxHp: room.config.bossHp,
            questionIds: room.actState!.questions.map((q) => q.id),
            startedAt: Date.now(),
          };

          const q = nextQuestion(room);
          if (!q) throw new Error('No boss questions available.');
          startQuestion(room, q, io);

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Revive: Request (player asks to be revived) ── */
    socket.on(
      'revive:request',
      (payload: { code: string; playerId: string }, ack: (res: Ack<{ pending: true }>) => void) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          const p = requirePlayer(room, (payload?.playerId || '').trim());

          if (!p.eliminated) throw new Error('You are not eliminated.');

          // Cannot request during active question or boss round
          if (room.phase === 'question' || room.phase === 'boss') {
            throw new Error('Cannot request a revive during an active question.');
          }

          // Cannot request during boss_fight act at all
          if (room.actState?.actId === 'boss_fight') {
            throw new Error('Revive shrine is not available during the Boss Fight.');
          }

          // Only one pending revive at a time
          if (room.pendingRevive) {
            throw new Error('Another revive request is already pending.');
          }

          room.pendingRevive = {
            playerId: p.playerId,
            playerName: p.name,
            requestedAt: Date.now(),
          };

          logger.info(`  🙏 ${p.name} requested a revive in room ${room.code}`);

          ack({ ok: true, data: { pending: true } });

          // Notify the requesting player that their request is pending
          io.to(p.socketId).emit('revive:pending', { playerName: p.name });

          // Notify host with full state update (includes pendingRevive)
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Revive: Approve (host approves revive) ── */
    socket.on(
      'revive:approve',
      (
        payload: { code: string; hostKey: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());

          if (!room.pendingRevive) throw new Error('No pending revive request.');

          const p = room.playersById.get(room.pendingRevive.playerId);
          if (!p) throw new Error('Player not found.');

          // Revive to full health
          p.eliminated = false;
          p.lives = room.config.maxLives;

          const playerName = room.pendingRevive.playerName;
          room.pendingRevive = undefined;

          logger.info(`  ✅ Host approved revive for ${playerName} in room ${room.code}`);

          // Notify the revived player
          io.to(p.socketId).emit('revive:result', { approved: true, playerName });

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Revive: Decline (host declines revive) ── */
    socket.on(
      'revive:decline',
      (
        payload: { code: string; hostKey: string },
        ack: (res: Ack<{ room: PublicRoomState }>) => void
      ) => {
        try {
          const code = (payload?.code || '').trim().toUpperCase();
          const room = requireRoom(code);
          requireHost(room, (payload?.hostKey || '').trim());

          if (!room.pendingRevive) throw new Error('No pending revive request.');

          const p = room.playersById.get(room.pendingRevive.playerId);
          const playerName = room.pendingRevive.playerName;
          room.pendingRevive = undefined;

          logger.info(`  ❌ Host declined revive for ${playerName} in room ${room.code}`);

          // Notify the declined player
          if (p) {
            io.to(p.socketId).emit('revive:result', { approved: false, playerName });
          }

          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Disconnect ── */
    socket.on('disconnect', () => {
      const code = socketToRoomCode.get(socket.id);
      socketToRoomCode.delete(socket.id);

      if (!code) return;
      const room = rooms.get(code);
      if (!room) return;

      if (room.hostSocketId === socket.id) {
        room.hostSocketId = null;
        logger.info(`Host disconnected from room ${room.code}`);
      }

      const playerId = room.socketToPlayerId.get(socket.id);
      if (playerId) {
        room.socketToPlayerId.delete(socket.id);
        const p = room.playersById.get(playerId);
        if (p) p.connected = false;
      }

      maybeForceCloseIfAllLocked(room);
      broadcastRoom(io, room);
      maybeEnd(room);
    });
  });

  app.get('/api/lan', (_req, res) => {
    const ip = getLanIPv4();
    res.json({ ip, port, url: ip ? `http://${ip}:${port}` : null });
  });

  // Question pack endpoints
  app.get('/api/packs', (_req, res) => {
    res.json({ packs: listPacks() });
  });

  // Hot-reload packs (dev only) — drop a new JSON and hit this
  if (dev) {
    app.post('/api/packs/reload', (_req, res) => {
      const count = loadQuestionPacks();
      res.json({ reloaded: count, packs: listPacks() });
    });
  }

  // Debug endpoint: room stats (dev only)
  if (dev) {
    app.get('/api/debug/rooms', (_req, res) => {
      const summary = Array.from(rooms.values()).map((r) => ({
        code: r.code,
        phase: r.phase,
        players: r.playersById.size,
        connected: Array.from(r.playersById.values()).filter((p) => p.connected).length,
        idleMs: Date.now() - r.lastActivityAt,
        act: r.actState?.actId ?? null,
      }));
      res.json({ roomCount: rooms.size, socketMappings: socketToRoomCode.size, rooms: summary });
    });
  }

  app.use((req, res) => handle(req, res));

  // Start periodic room cleanup
  setInterval(cleanupRooms, ROOM_CLEANUP_INTERVAL_MS);
  logger.info(
    `Room cleanup: every ${ROOM_CLEANUP_INTERVAL_MS / 1000}s, idle timeout ${ROOM_IDLE_TIMEOUT_MS / 1000}s`
  );

  httpServer.listen(port, '0.0.0.0', () => {
    const ip = getLanIPv4();
    logger.info(`> Ready on http://localhost:${port}`);
    logger.info(`> LAN: ${ip ? `http://${ip}:${port}` : 'Could not detect LAN IP'}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
