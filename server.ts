import { logger } from '@/lib/logger';
import express from 'express';
import { createServer } from 'http';
import { customAlphabet, nanoid } from 'nanoid';
import next from 'next';
import os from 'os';
import { Server } from 'socket.io';

/* ────────────────────── Types ────────────────────── */

type Phase = 'lobby' | 'question' | 'reveal' | 'shop' | 'boss' | 'ended';

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

  inventory: Record<string, number>;

  /** Passive buffs that are "armed" and waiting to trigger */
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
  /** Per-player bonus time from freeze_time (ms) */
  freezeBonus: Map<string, number>;
  locked: boolean;
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
    locked: boolean;
  };
  shop?: { open: boolean; items: ShopItem[] };
  boss?: BossState;
  remainingQuestions: number;
};

type HostRoomState = {
  code: string;
  phase: Phase;
  hostKey: string;
  currentAnswerIndex?: number;
  correctChoice?: string;
  questionDebug?: Question;
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
  questionDurationMs: 25_000,
  startingCoins: 150,
  buybackCostCoins: 200,
  bossHp: 6,
};

/**
 * ITEM CATALOGUE
 *
 * Passive items: bought in shop → buff icon appears → auto-triggers at the right moment
 *   - double_points: auto-consumed on next correct answer (during reveal)
 *   - shield: auto-consumed when you'd lose a heart (during reveal)
 *   - buyback_token: auto-consumed when you're eliminated (during reveal)
 *
 * Active items: bought in shop → "Use" button during question phase
 *   - fifty_fifty: removes 2 wrong answers
 *   - freeze_time: adds +10s to your personal timer
 */
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

type Room = {
  code: string;
  createdAt: number;
  hostKey: string;
  hostSocketId: string | null;
  phase: Phase;
  config: RoomConfig;
  playersById: Map<string, Player>;
  socketToPlayerId: Map<string, string>;
  questionDeck: Question[];
  questionIndex: number;
  currentQuestion?: CurrentQuestion;
  shopOpen: boolean;
  boss?: BossState;
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

function sampleQuestions(): Question[] {
  return [
    {
      id: 'q1',
      category: 'General',
      prompt: 'Which language is used to style web pages?',
      choices: ['HTML', 'CSS', 'TypeScript', 'Node.js'],
      answerIndex: 1,
      value: 100,
    },
    {
      id: 'q2',
      category: 'Gaming',
      prompt: 'In Rocket League, what do you hit into the goal?',
      choices: ['Puck', 'Ball', 'Disc', 'Cube'],
      answerIndex: 1,
      value: 100,
    },
    {
      id: 'q3',
      category: 'Internet',
      prompt: "What does 'DM' commonly stand for?",
      choices: ['Direct Message', 'Data Mode', 'Dynamic Module', 'Dual Monitor'],
      answerIndex: 0,
      value: 100,
    },
    {
      id: 'q4',
      category: 'General',
      prompt: 'Which of these is NOT a database?',
      choices: ['PostgreSQL', 'MongoDB', 'Redis', 'TailwindCSS'],
      answerIndex: 3,
      value: 150,
    },
    {
      id: 'q5',
      category: 'Gaming',
      prompt: 'Which company makes the PlayStation?',
      choices: ['Nintendo', 'Sony', 'Microsoft', 'Valve'],
      answerIndex: 1,
      value: 150,
    },
  ];
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

    inventory: inv,

    buffs: {
      doublePoints: (inv.double_points ?? 0) > 0,
      shield: (inv.shield ?? 0) > 0,
    },
  };
}

function getCurrentQuestion(room: Room): Question | undefined {
  if (!room.currentQuestion) return undefined;
  return room.questionDeck.find((q) => q.id === room.currentQuestion?.questionId);
}

function toPublicQuestion(q: Question): PublicQuestion {
  return {
    id: q.id,
    category: q.category,
    prompt: q.prompt,
    choices: q.choices,
    value: q.value,
  };
}

function roomToPublic(room: Room): PublicRoomState {
  const players = Array.from(room.playersById.values())
    .map(toPublicPlayer)
    .sort((a, b) => a.joinedAt - b.joinedAt);

  const q = getCurrentQuestion(room);

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
          }
        : undefined,
    shop: {
      open: room.shopOpen,
      items: SHOP_ITEMS,
    },
    boss: room.boss,
    remainingQuestions: Math.max(0, room.questionDeck.length - room.questionIndex),
  };
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
  if (room.questionIndex >= room.questionDeck.length) return null;
  const q = room.questionDeck[room.questionIndex];
  room.questionIndex += 1;
  return q;
}

function startQuestion(room: Room, q: Question) {
  const now = Date.now();
  room.phase = room.boss ? 'boss' : 'question';
  room.currentQuestion = {
    questionId: q.id,
    startedAt: now,
    endsAt: now + room.config.questionDurationMs,
    answersByPlayerId: new Map(),
    freezeBonus: new Map(),
    locked: false,
  };
}

/**
 * Arms passive buffs when a passive item is purchased.
 * Called from shop:buy for passive items.
 */
function armPassiveBuff(p: Player, itemId: ShopItemId) {
  if (itemId === 'double_points') p.buffs.doublePoints = true;
  if (itemId === 'shield') p.buffs.shield = true;
  // buyback_token doesn't need a buff flag — we check inventory directly on elimination
}

/**
 * Core scoring + passive item auto-trigger logic.
 *
 * Order of operations for each player:
 * 1. Check if they answered correctly
 * 2. If correct: apply score (2x if double_points buff active, consume it)
 * 3. If wrong: lose a heart (unless shield buff active, consume it)
 * 4. If eliminated: check for buyback_token in inventory, auto-revive
 */
function revealAndScore(room: Room) {
  const q = getCurrentQuestion(room);
  if (!q || !room.currentQuestion) return;

  room.currentQuestion.locked = true;
  room.phase = 'reveal';

  for (const p of room.playersById.values()) {
    if (p.eliminated) continue;

    const ans = room.currentQuestion.answersByPlayerId.get(p.playerId);
    const answered = typeof ans === 'number';
    const correct = answered && ans === q.answerIndex;

    if (correct) {
      // ── Double Points (passive auto-trigger) ──
      let multiplier = 1;
      if (p.buffs.doublePoints) {
        multiplier = 2;
        p.buffs.doublePoints = false;
        const count = p.inventory['double_points'] || 0;
        if (count > 0) p.inventory['double_points'] = count - 1;
        logger.info(`  🌟 ${p.name}: double points consumed`);
      }

      const delta = q.value * multiplier;
      p.score += delta;
      p.coins += Math.floor(q.value / 2);

      if (room.boss) {
        room.boss.hp = Math.max(0, room.boss.hp - 1);
      }
    } else {
      // ── Shield (passive auto-trigger) ──
      if (p.buffs.shield) {
        p.buffs.shield = false;
        const count = p.inventory['shield'] || 0;
        if (count > 0) p.inventory['shield'] = count - 1;
        logger.info(`  🛡️ ${p.name}: shield absorbed the hit`);
        // No heart loss!
      } else {
        p.lives -= 1;
        if (p.lives <= 0) {
          p.lives = 0;

          // ── Buyback Token (passive auto-trigger on elimination) ──
          const tokenCount = p.inventory['buyback_token'] || 0;
          if (tokenCount > 0) {
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
  }
}

function openShop(room: Room, open: boolean) {
  room.shopOpen = open;
  room.phase = open ? 'shop' : 'reveal'; // closing shop returns to reveal so host can hit Next
}

function maybeEnd(room: Room) {
  const alive = Array.from(room.playersById.values()).filter((p) => !p.eliminated);
  if (alive.length === 0) room.phase = 'ended';
  if (room.boss && room.boss.hp <= 0) room.phase = 'ended';
  if (room.questionIndex >= room.questionDeck.length && !room.boss) room.phase = 'ended';
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
            questionDeck: shuffle(sampleQuestions()),
            questionIndex: 0,
            currentQuestion: undefined,
            shopOpen: false,
            boss: undefined,
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

    /* ── Game: Start (first question or resume from shop) ── */
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

          revealAndScore(room);
          maybeEnd(room);

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

    /* ── Shop: Open / Close ──
     * Shop can only be opened during the reveal phase (between questions).
     * Closing returns to reveal so the host can then hit "Next Question".
     */
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

          if (open && room.phase !== 'reveal' && room.phase !== 'shop') {
            throw new Error('Shop can only be opened after revealing an answer.');
          }

          openShop(room, open);
          ack({ ok: true, data: { room: roomToPublic(room) } });
          broadcastRoom(io, room);
        } catch (e) {
          ack({ ok: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    );

    /* ── Shop: Buy ──
     * Players can buy during shop phase.
     * Passive items auto-arm their buff on purchase.
     */
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
          if (p.coins < item.cost) throw new Error('Not enough coins.');

          p.coins -= item.cost;
          p.inventory[item.id] = (p.inventory[item.id] || 0) + 1;

          // Auto-arm passive buffs on purchase
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

    /* ── Item: Use (active items only) ──
     * Only active items can be "used". Passive items auto-trigger.
     * Active items can only be used during question/boss phase.
     */
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
          if (room.currentQuestion.locked) throw new Error('Question is locked.');
          if (p.eliminated) throw new Error('You are eliminated.');

          const q = getCurrentQuestion(room);
          if (!q) throw new Error('Question not found.');
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

    /* ── Player: Buyback (manual coin buyback, separate from token) ── */
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

          const questionIds = shuffle(sampleQuestions()).map((q) => q.id);
          room.boss = {
            hp: room.config.bossHp,
            maxHp: room.config.bossHp,
            questionIds,
            startedAt: Date.now(),
          };

          room.questionDeck = shuffle(sampleQuestions());
          room.questionIndex = 0;
          room.currentQuestion = undefined;

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
