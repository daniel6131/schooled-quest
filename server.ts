import { logger } from '@/lib/logger';
import express from 'express';
import { createServer } from 'http';
import { customAlphabet, nanoid } from 'nanoid';
import next from 'next';
import os from 'os';
import { Server } from 'socket.io';

/* ────────────────────── Types ────────────────────── */

type Phase = 'lobby' | 'question' | 'reveal' | 'shop' | 'boss' | 'intermission' | 'ended';
type ActId = 'homeroom' | 'pop_quiz' | 'field_trip' | 'boss_fight';

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
  startingCoins: number;
  buybackCostCoins: number;
  bossHp: number;
};

type CurrentQuestion = {
  questionId: string;
  startedAt: number;
  endsAt: number;
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
    startedAt: number;
    endsAt: number;
    revealAt: number;
    locked: boolean;
    revealedAnswerIndex?: number;
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

const ACT_ORDER: ActId[] = ['homeroom', 'pop_quiz', 'field_trip', 'boss_fight'];

/* ────────────────────── Question Bank (per act) ────────────────────── */

/**
 * Sample questions organized by act. In production these would come from a DB or JSON file.
 * For now we have a handful per act for testing.
 */
function getActQuestions(actId: ActId): Question[] {
  switch (actId) {
    case 'homeroom':
      return [
        {
          id: 'hr1',
          category: 'General',
          prompt: 'Which language is used to style web pages?',
          choices: ['HTML', 'CSS', 'TypeScript', 'Node.js'],
          answerIndex: 1,
          value: 100,
        },
        {
          id: 'hr2',
          category: 'Gaming',
          prompt: 'In Rocket League, what do you hit into the goal?',
          choices: ['Puck', 'Ball', 'Disc', 'Cube'],
          answerIndex: 1,
          value: 100,
        },
        {
          id: 'hr3',
          category: 'Internet',
          prompt: "What does 'DM' commonly stand for?",
          choices: ['Direct Message', 'Data Mode', 'Dynamic Module', 'Dual Monitor'],
          answerIndex: 0,
          value: 100,
        },
        {
          id: 'hr4',
          category: 'General',
          prompt: 'Which of these is NOT a database?',
          choices: ['PostgreSQL', 'MongoDB', 'Redis', 'TailwindCSS'],
          answerIndex: 3,
          value: 150,
        },
        {
          id: 'hr5',
          category: 'Gaming',
          prompt: 'Which company makes the PlayStation?',
          choices: ['Nintendo', 'Sony', 'Microsoft', 'Valve'],
          answerIndex: 1,
          value: 100,
        },
      ];

    case 'pop_quiz':
      return [
        {
          id: 'pq1',
          category: 'Science',
          prompt: 'What is the chemical symbol for gold?',
          choices: ['Go', 'Gd', 'Au', 'Ag'],
          answerIndex: 2,
          value: 150,
        },
        {
          id: 'pq2',
          category: 'Geography',
          prompt: 'What is the capital of Australia?',
          choices: ['Sydney', 'Melbourne', 'Canberra', 'Perth'],
          answerIndex: 2,
          value: 150,
        },
        {
          id: 'pq3',
          category: 'Music',
          prompt: "Which artist released the album 'Blonde'?",
          choices: ['Tyler, The Creator', 'Kanye West', 'Frank Ocean', 'Childish Gambino'],
          answerIndex: 2,
          value: 200,
          hard: true,
        },
        {
          id: 'pq4',
          category: 'History',
          prompt: 'In which year did the Berlin Wall fall?',
          choices: ['1987', '1989', '1991', '1993'],
          answerIndex: 1,
          value: 200,
          hard: true,
        },
      ];

    case 'field_trip':
      return [
        {
          id: 'ft1',
          category: 'Science',
          prompt: 'How many bones are in the adult human body?',
          choices: ['186', '196', '206', '216'],
          answerIndex: 2,
          value: 200,
        },
        {
          id: 'ft2',
          category: 'Geography',
          prompt: 'Which country has the most time zones?',
          choices: ['Russia', 'USA', 'France', 'China'],
          answerIndex: 2,
          value: 250,
        },
        {
          id: 'ft3',
          category: 'Movies',
          prompt: "Who directed 'Inception'?",
          choices: ['Steven Spielberg', 'Christopher Nolan', 'Denis Villeneuve', 'James Cameron'],
          answerIndex: 1,
          value: 200,
        },
      ];

    case 'boss_fight':
      return [
        {
          id: 'bf1',
          category: 'Boss',
          prompt: 'What year was the first iPhone released?',
          choices: ['2005', '2006', '2007', '2008'],
          answerIndex: 2,
          value: 300,
        },
        {
          id: 'bf2',
          category: 'Boss',
          prompt: 'Which element has the atomic number 1?',
          choices: ['Helium', 'Hydrogen', 'Lithium', 'Carbon'],
          answerIndex: 1,
          value: 350,
        },
        {
          id: 'bf3',
          category: 'Boss',
          prompt: 'In chess, which piece can only move diagonally?',
          choices: ['Rook', 'Knight', 'Bishop', 'Queen'],
          answerIndex: 2,
          value: 400,
        },
      ];

    default:
      return [];
  }
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

type Room = {
  code: string;
  createdAt: number;
  hostKey: string;
  hostSocketId: string | null;
  phase: Phase;
  config: RoomConfig;
  playersById: Map<string, Player>;
  socketToPlayerId: Map<string, string>;

  /** The current act state — null only during lobby */
  actState: ActState | null;

  /** Legacy fields kept for boss mode compatibility */
  questionDeck: Question[];
  questionIndex: number;
  currentQuestion?: CurrentQuestion;
  shopOpen: boolean;
  boss?: BossState;
  /** Active revive request awaiting host decision */
  pendingRevive?: ReviveRequest;
};

const rooms = new Map<string, Room>();

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
            startedAt: room.currentQuestion.startedAt,
            endsAt: room.currentQuestion.endsAt,
            locked: room.currentQuestion.locked,
            revealAt: computeRevealAt(room),
            revealedAnswerIndex: room.currentQuestion.locked ? q.answerIndex : undefined,
          }
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
    pendingRevive: room.pendingRevive,
  };
}

function broadcastRoom(io: Server, room: Room) {
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

function startQuestion(room: Room, q: Question) {
  const now = Date.now();
  const durationMs = getQuestionDurationMs(room);

  // Reset per-question flags
  for (const p of room.playersById.values()) {
    p.lockedIn = false;
  }

  room.phase = room.boss ? 'boss' : 'question';
  room.currentQuestion = {
    questionId: q.id,
    startedAt: now,
    endsAt: now + durationMs,
    answersByPlayerId: new Map(),
    lockinTimeByPlayerId: new Map(),
    freezeBonus: new Map(),
    locked: false,
    forcedRevealAt: undefined,
  };
}

/** Start a new act: loads its questions and resets act-level state */
function startAct(room: Room, actId: ActId) {
  const config = ACT_CONFIGS[actId];
  const questions = shuffle(getActQuestions(actId));

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

  const heartsAtRisk = doesQuestionCostHearts(room, q);
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
  await nextApp.prepare();
  const app = express();
  const httpServer = createServer(app);
  const port = Number(process.env.PORT || 3000);

  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    pingTimeout: 60_000,
    pingInterval: 25_000,
  });

  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'socket connected');

    socket.onAny((event) => {
      logger.info('event', event, 'from', socket.id);
    });

    /* ── Room: Create ── */
    socket.on(
      'room:create',
      (
        payload: { hostName: string },
        ack: (res: Ack<{ room: PublicRoomState; hostKey: string }>) => void
      ) => {
        try {
          const hostName = (payload?.hostName || '').trim().slice(0, 20);
          if (!hostName) return ack({ ok: false, error: 'Host name is required.' });

          let code = makeCode();
          for (let i = 0; i < 10 && rooms.has(code); i++) code = makeCode();

          const hostKey = nanoid(24);

          const room: Room = {
            code,
            createdAt: Date.now(),
            hostKey,
            hostSocketId: socket.id,
            phase: 'lobby',
            config: { ...DEFAULT_CONFIG },
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
          socket.join(code);
          logger.info(`Room ${code} created by host "${hostName}"`);

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
          socket.join(code);

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
            socket.join(code);
            ack({ ok: true, data: { room: roomToPublic(room), isHost: true } });
            broadcastRoom(io, room);
            return;
          }

          if (!playerId) return ack({ ok: false, error: 'playerId is required.' });

          const p = requirePlayer(room, playerId);
          p.socketId = socket.id;
          p.connected = true;
          room.socketToPlayerId.set(socket.id, playerId);
          socket.join(code);

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
      socket.leave(code);
      broadcastRoom(io, room);
      maybeEnd(room);
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

          // Auto-start the first question
          const q = nextQuestion(room);
          if (!q) throw new Error('No questions available for this act.');
          startQuestion(room, q);

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
          startQuestion(room, q);

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

          startQuestion(room, q);
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

          const q = getCurrentQuestion(room);
          if (!q || !room.currentQuestion) throw new Error('No active question.');

          if (room.currentQuestion.locked) throw new Error('Question is locked.');
          if (p.eliminated) throw new Error('You are eliminated.');
          if (p.lockedIn) throw new Error('Answer locked in.');

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
          startQuestion(room, q);

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
      for (const room of rooms.values()) {
        if (room.hostSocketId === socket.id) {
          room.hostSocketId = null;
          logger.info(`Host disconnected from room ${room.code}`);
        }

        const playerId = room.socketToPlayerId.get(socket.id);
        if (!playerId) continue;
        room.socketToPlayerId.delete(socket.id);
        const p = room.playersById.get(playerId);
        if (p) p.connected = false;
        maybeForceCloseIfAllLocked(room);
        broadcastRoom(io, room);
        maybeEnd(room);
      }
    });
  });

  app.get('/api/lan', (_req, res) => {
    const ip = getLanIPv4();
    res.json({ ip, port, url: ip ? `http://${ip}:${port}` : null });
  });

  app.use((req, res) => handle(req, res));

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
