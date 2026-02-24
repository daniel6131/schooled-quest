export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type Phase =
  | 'lobby'
  | 'countdown'
  | 'question'
  | 'reveal'
  | 'shop'
  | 'boss'
  | 'intermission'
  | 'ended';

export type ActId = 'homeroom' | 'pop_quiz' | 'field_trip' | 'boss_fight';

export type ActConfig = {
  id: ActId;
  name: string;
  emoji: string;
  description: string;
  /** Timer duration for questions in this act (ms) */
  questionDurationMs: number;
  /** Whether wrong answers cost hearts */
  heartsAtRisk: boolean;
  /** Only lose hearts on "hard" questions (used in Pop Quiz) */
  heartsOnlyOnHard: boolean;
  /** Coin reward for correct answer (base, before multipliers) */
  coinRewardBase: number;
  /** Score value multiplier for this act (e.g. 1.0, 1.5, 2.0) */
  scoreMultiplier: number;
  /** Which shop items are available for purchase during this act's shop windows */
  availableShopItems: ShopItemId[];
  /** Max speed bonus points for an instant lock-in (scales linearly with time remaining) */
  speedBonusMax: number;
};

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

  /** Whether you have locked in your answer for the current question. */
  lockedIn: boolean;

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
  /** Whether this question is tagged as "hard" (affects heart loss in some acts) */
  hard?: boolean;
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
    countdownMs: number;
    startingCoins: number;
    buybackCostCoins: number;
    bossHp: number;
  };
  players: Player[];
  currentQuestion?: {
    question: PublicQuestion;
    /** When the countdown finishes and the question timer starts */
    countdownEndsAt?: number;
    startedAt: number;
    endsAt: number;
    /** When the host is allowed to reveal (accounts for Freeze Time + early end). */
    revealAt: number;
    locked: boolean;
    /** Present only after host reveals. */
    revealedAnswerIndex?: number;
  };
  shop?: {
    open: boolean;
    items: ShopItem[];
  };
  boss?: BossState;
  remainingQuestions: number;

  /** Current act info */
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

export type ReviveRequest = {
  playerId: string;
  playerName: string;
  requestedAt: number;
};

export type HostRoomState = {
  code: string;
  phase: Phase;
  hostKey: string;
  currentAnswerIndex?: number;
  correctChoice?: string;
  questionDebug?: JsonValue;
  /** Act info for host dashboard */
  currentAct?: {
    id: ActId;
    name: string;
    emoji: string;
    questionNumber: number;
    totalQuestions: number;
    heartsAtRisk: boolean;
  };
  /** Available acts the host can advance to */
  availableActs?: ActId[];
  /** If set, a player is requesting to be revived and host must approve/decline */
  pendingRevive?: ReviveRequest;
};

export type PlayerRevealPayload = {
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
  /** Whether hearts were at risk for this question */
  heartsAtRisk?: boolean;
  /** Speed bonus points earned (0 if not locked in or wrong) */
  speedBonus?: number;
};

export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

export type PackSummary = {
  id: string;
  name: string;
  description: string;
  questionCounts: Record<string, number>;
  totalQuestions: number;
};
