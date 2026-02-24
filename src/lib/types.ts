export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Phase = 'lobby' | 'question' | 'reveal' | 'shop' | 'boss' | 'ended';

export type Player = {
  playerId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  joinedAt: number;

  lives: number;
  score: number;
  coins: number;
  eliminated: boolean;

  inventory: Record<string, number>;

  /** Passive buffs currently active — shown as indicators on the player's HUD */
  buffs: {
    doublePoints?: boolean;
    shield?: boolean;
  };
};

export type PublicQuestion = {
  id: string;
  category: string;
  prompt: string;
  choices: string[];
  value: number;
};

/**
 * Items are split into two categories:
 *
 * PASSIVE (auto-trigger, no "use" button):
 *   - double_points: Next correct answer scores 2x. Consumed on next reveal.
 *   - shield: Negates next heart loss. Consumed when you'd lose a heart.
 *   - buyback_token: Auto-revives you with 1 life when eliminated.
 *
 * ACTIVE (tap to use during a question):
 *   - fifty_fifty: Removes 2 wrong answers. Use during question phase.
 *   - freeze_time: Adds +10s to your timer. Use during question phase.
 *   - call_audience: Spectators vote, you see poll. Use during question phase.
 */
export type ShopItemId =
  | 'double_points'
  | 'shield'
  | 'buyback_token'
  | 'fifty_fifty'
  | 'freeze_time';

export type ShopItem = {
  id: ShopItemId;
  name: string;
  cost: number;
  description: string;
  kind: 'passive' | 'active';
};

export type BossState = {
  hp: number;
  maxHp: number;
  questionIds: string[];
  currentQuestionId?: string;
  startedAt: number;
};

export type PublicRoomState = {
  code: string;
  createdAt: number;
  phase: Phase;
  config: {
    maxLives: number;
    questionDurationMs: number;
    startingCoins: number;
    buybackCostCoins: number;
    bossHp: number;
  };
  players: Player[];
  currentQuestion?: {
    question: PublicQuestion;
    startedAt: number;
    endsAt: number;
    locked: boolean;
  };
  shop?: {
    open: boolean;
    items: ShopItem[];
  };
  boss?: BossState;
  remainingQuestions: number;
};

export type HostRoomState = {
  code: string;
  phase: Phase;
  hostKey: string;
  currentAnswerIndex?: number;
  correctChoice?: string;
  questionDebug?: JsonValue;
};

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };
