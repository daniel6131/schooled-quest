/**
 * Question Pack Loader
 *
 * Reads JSON question packs from `data/question-packs/`, validates them,
 * and exposes them to the server by pack ID.
 *
 * Pack format:
 * {
 *   "id": "my-pack",
 *   "name": "My Pack",
 *   "description": "Optional description",
 *   "version": 1,
 *   "questions": {
 *     "homeroom": [ { category, prompt, choices, answerIndex, value, hard? } ],
 *     "pop_quiz": [...],
 *     "field_trip": [...],
 *     "wager_round": [...],
 *     "boss_fight": [...]
 *   }
 * }
 *
 * - `id` is auto-derived from filename if not present in JSON.
 * - Questions get auto-assigned IDs like "packId_actId_0", "packId_actId_1", etc.
 * - Validation rejects packs with bad answerIndex, missing fields, etc.
 */

import { logger } from '@/lib/logger';
import fs from 'fs';
import path from 'path';

/* ── Types ── */

const VALID_ACT_IDS = ['homeroom', 'pop_quiz', 'field_trip', 'wager_round', 'boss_fight'] as const;
type ActId = (typeof VALID_ACT_IDS)[number];

type Question = {
  id: string;
  category: string;
  prompt: string;
  hint?: string;
  extraHint?: string;
  choices: string[];
  answerIndex: number;
  value: number;
  hard?: boolean;
};

type RawQuestion = {
  category?: unknown;
  prompt?: unknown;
  hint?: unknown;
  extraHint?: unknown;
  choices?: unknown;
  answerIndex?: unknown;
  value?: unknown;
  hard?: unknown;
};

type QuestionPack = {
  id: string;
  name: string;
  description: string;
  version: number;
  questions: Record<ActId, Question[]>;
};

type PackSummary = {
  id: string;
  name: string;
  description: string;
  questionCounts: Record<ActId, number>;
  totalQuestions: number;
};

/* ── Validation ── */

function validateQuestion(
  raw: RawQuestion,
  packId: string,
  actId: string,
  index: number
): string | null {
  const prefix = `Pack "${packId}" → ${actId}[${index}]`;

  if (typeof raw.category !== 'string' || raw.category.trim().length === 0) {
    return `${prefix}: "category" must be a non-empty string`;
  }
  if (typeof raw.prompt !== 'string' || raw.prompt.trim().length === 0) {
    return `${prefix}: "prompt" must be a non-empty string`;
  }
  if (raw.hint !== undefined && (typeof raw.hint !== 'string' || raw.hint.trim().length === 0)) {
    return `${prefix}: "hint" must be a non-empty string if present`;
  }
  if (
    raw.extraHint !== undefined &&
    (typeof raw.extraHint !== 'string' || raw.extraHint.trim().length === 0)
  ) {
    return `${prefix}: "extraHint" must be a non-empty string if present`;
  }
  if (!Array.isArray(raw.choices) || raw.choices.length < 2 || raw.choices.length > 6) {
    return `${prefix}: "choices" must be an array of 2-6 strings`;
  }
  for (let i = 0; i < raw.choices.length; i++) {
    if (typeof raw.choices[i] !== 'string' || (raw.choices[i] as string).trim().length === 0) {
      return `${prefix}: choices[${i}] must be a non-empty string`;
    }
  }
  if (typeof raw.answerIndex !== 'number' || !Number.isInteger(raw.answerIndex)) {
    return `${prefix}: "answerIndex" must be an integer`;
  }
  if (raw.answerIndex < 0 || raw.answerIndex >= (raw.choices as string[]).length) {
    return `${prefix}: "answerIndex" ${raw.answerIndex} is out of bounds (${(raw.choices as string[]).length} choices)`;
  }
  if (typeof raw.value !== 'number' || raw.value <= 0) {
    return `${prefix}: "value" must be a positive number`;
  }
  if (raw.hard !== undefined && typeof raw.hard !== 'boolean') {
    return `${prefix}: "hard" must be a boolean if present`;
  }

  return null; // valid
}

/* ── Loader ── */

const PACKS_DIR = path.join(process.cwd(), 'data', 'question-packs');

/** All loaded packs, keyed by pack ID */
const packs = new Map<string, QuestionPack>();

/**
 * Load (or reload) all question packs from the data/question-packs/ directory.
 * Returns the number of packs loaded successfully.
 */
export function loadQuestionPacks(): number {
  packs.clear();

  if (!fs.existsSync(PACKS_DIR)) {
    logger.warn({ dir: PACKS_DIR }, 'Question packs directory not found — no packs loaded');
    return 0;
  }

  const files = fs.readdirSync(PACKS_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    logger.warn({ dir: PACKS_DIR }, 'No .json files found in question packs directory');
    return 0;
  }

  let loaded = 0;

  for (const file of files) {
    const filePath = path.join(PACKS_DIR, file);
    const fileId = path.basename(file, '.json');

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      const packId = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : fileId;
      const packName = typeof raw.name === 'string' ? raw.name : packId;
      const packDesc = typeof raw.description === 'string' ? raw.description : '';
      const packVersion = typeof raw.version === 'number' ? raw.version : 1;

      if (!raw.questions || typeof raw.questions !== 'object') {
        logger.error({ file }, 'Pack missing "questions" object — skipped');
        continue;
      }

      const questions: Record<string, Question[]> = {};
      let totalErrors = 0;
      let totalQuestions = 0;

      for (const actId of VALID_ACT_IDS) {
        const rawQuestions = raw.questions[actId];
        if (!rawQuestions) {
          questions[actId] = [];
          continue;
        }

        if (!Array.isArray(rawQuestions)) {
          logger.error(
            { file, actId },
            `Pack "${packId}" → "${actId}" is not an array — skipped act`
          );
          questions[actId] = [];
          continue;
        }

        const validated: Question[] = [];

        for (let i = 0; i < rawQuestions.length; i++) {
          const err = validateQuestion(rawQuestions[i], packId, actId, i);
          if (err) {
            logger.error(err);
            totalErrors++;
            continue;
          }

          validated.push({
            id: `${packId}_${actId}_${i}`,
            category: (rawQuestions[i].category as string).trim(),
            prompt: (rawQuestions[i].prompt as string).trim(),
            hint:
              typeof rawQuestions[i].hint === 'string' && rawQuestions[i].hint.trim().length > 0
                ? (rawQuestions[i].hint as string).trim()
                : undefined,
            extraHint:
              typeof rawQuestions[i].extraHint === 'string' &&
              rawQuestions[i].extraHint.trim().length > 0
                ? (rawQuestions[i].extraHint as string).trim()
                : undefined,
            choices: (rawQuestions[i].choices as string[]).map((c: string) => c.trim()),
            answerIndex: rawQuestions[i].answerIndex as number,
            value: rawQuestions[i].value as number,
            hard: rawQuestions[i].hard === true ? true : undefined,
          });
        }

        questions[actId] = validated;
        totalQuestions += validated.length;
      }

      if (totalQuestions === 0) {
        logger.error({ file, packId }, 'Pack has 0 valid questions after validation — skipped');
        continue;
      }

      if (totalErrors > 0) {
        logger.warn(
          { packId, errors: totalErrors, valid: totalQuestions },
          'Pack loaded with validation errors'
        );
      }

      packs.set(packId, {
        id: packId,
        name: packName,
        description: packDesc,
        version: packVersion,
        questions: questions as Record<ActId, Question[]>,
      });

      const counts = VALID_ACT_IDS.map((a) => `${a}: ${questions[a].length}`).join(', ');
      logger.info({ packId, totalQuestions, counts }, `Loaded question pack "${packName}"`);
      loaded++;
    } catch (e) {
      logger.error(
        { file, error: e instanceof Error ? e.message : String(e) },
        'Failed to parse question pack'
      );
    }
  }

  logger.info({ loaded, total: files.length, dir: PACKS_DIR }, 'Question pack loading complete');
  return loaded;
}

/** Get a loaded pack by ID. Returns undefined if not found. */
export function getPack(packId: string): QuestionPack | undefined {
  return packs.get(packId);
}

/** Get questions for a specific act from a specific pack. */
export function getPackQuestions(packId: string, actId: string): Question[] {
  const pack = packs.get(packId);
  if (!pack) return [];
  return pack.questions[actId as ActId] ?? [];
}

/** List all available packs (summary info for the host to choose from). */
export function listPacks(): PackSummary[] {
  return Array.from(packs.values()).map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    questionCounts: Object.fromEntries(
      VALID_ACT_IDS.map((a) => [a, p.questions[a].length])
    ) as Record<ActId, number>,
    totalQuestions: VALID_ACT_IDS.reduce((sum, a) => sum + p.questions[a].length, 0),
  }));
}

/** Get the default pack ID (first loaded, or 'default' if it exists). */
export function getDefaultPackId(): string | undefined {
  if (packs.has('default')) return 'default';
  const first = packs.keys().next();
  return first.done ? undefined : first.value;
}

/** Check if any packs are loaded. */
export function hasAnyPacks(): boolean {
  return packs.size > 0;
}
