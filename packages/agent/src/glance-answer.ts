import type { Glance, IsoTime, KeyFile, Pr, PrKey } from '@postpile/core';
import type { z } from 'zod';
import type { glanceBatchOutput } from './schemas.ts';
import { glanceBatchItemOutput } from './schemas.ts';
import type { GlanceBatchInput, GlanceBatchItem } from './service.ts';

type GlanceBatchAnswer = z.infer<typeof glanceBatchOutput>;

export interface GlanceStamp {
  model: string;
  createdAt: IsoTime;
  inputHash: (item: GlanceBatchItem) => string;
}

export interface MappedGlances {
  glances: Glance[];
  missing: PrKey[];
  /** Why each missing PR is missing, for the sync's error line. */
  missingWhy: Partial<Record<PrKey, string>>;
}

/**
 * The batch key an answered prKey means. Exact first; else ignoring case
 * and spaces ("posthog/posthog #12"), when that still points at one PR.
 */
function batchKeyFor(answered: unknown, keys: PrKey[]): PrKey | null {
  if (typeof answered !== 'string') {
    return null;
  }
  const trimmed = answered.trim();
  if (keys.includes(trimmed)) {
    return trimmed;
  }
  const loose = (key: string) => key.toLowerCase().replace(/\s+/g, '');
  const matches = keys.filter((key) => loose(key) === loose(trimmed));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** "verdict \"LOOKS_SASAFE\" is not one of the three" or "invalid forYou, does", for the error line. */
function entryProblem(entry: Record<string, unknown>, fields: string[]): string {
  const verdict = entry.verdict;
  if (fields.includes('verdict') && typeof verdict === 'string') {
    const rest = fields.filter((field) => field !== 'verdict');
    const more = rest.length > 0 ? `, and invalid ${rest.join(', ')}` : '';
    return `answered with verdict "${verdict.slice(0, 40)}", not one of LOOKS_SAFE, LOOK_CLOSER, NOT_YOURS${more}`;
  }
  return `answered with missing or invalid ${fields.join(', ')}`;
}

/** At most this many key files per glance. */
const KEY_FILES_MAX = 3;

/**
 * The answered key files that are really in the PR: paths not among its
 * changed files are dropped (the model may guess or garble one), repeats
 * too, and at most three are kept. A leading "./" or "/" is forgiven.
 */
export function keyFilesFor(answered: KeyFile[], pr: Pr): KeyFile[] {
  const changed = new Set(pr.files.map((file) => file.path));
  const kept: KeyFile[] = [];
  for (const entry of answered) {
    const path = entry.path.replace(/^\.?\//, '');
    if (changed.has(path) && !kept.some((file) => file.path === path)) {
      kept.push({ path, why: entry.why });
    }
  }
  return kept.slice(0, KEY_FILES_MAX);
}

/**
 * Checks every entry on its own, so one bad entry costs one PR, not the
 * batch. Entries for PRs not in the batch and repeats are dropped; whatever
 * the batch asked for and did not get validly is missing, with the reason.
 */
export function mapGlanceAnswer(answer: GlanceBatchAnswer, input: GlanceBatchInput, stamp: GlanceStamp): MappedGlances {
  const items = new Map(input.items.map((item) => [item.pr.key, item]));
  const keys = [...items.keys()];
  const done = new Map<PrKey, Glance>();
  const problems = new Map<PrKey, string>();
  for (const entry of answer.glances) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const key = batchKeyFor(record.prKey, keys);
    const item = key === null ? undefined : items.get(key);
    if (key === null || !item || done.has(key)) {
      continue;
    }
    const parsed = glanceBatchItemOutput.safeParse(record);
    if (!parsed.success) {
      const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0] ?? 'entry')))];
      problems.set(key, entryProblem(record, fields));
      continue;
    }
    const value = parsed.data;
    problems.delete(key);
    done.set(key, {
      prKey: key,
      verdict: value.verdict,
      forYou: value.forYou,
      does: value.does,
      risk: value.risk,
      othersSaid: value.othersSaid,
      keyFiles: keyFilesFor(value.keyFiles, item.pr),
      pullInReason: item.provenance.kind === 'pulled_in' ? item.provenance.reason : null,
      dossierVersion: input.dossier?.version ?? null,
      inputHash: stamp.inputHash(item),
      model: stamp.model,
      createdAt: stamp.createdAt,
    });
  }
  const missing = keys.filter((key) => !done.has(key));
  const missingWhy: Partial<Record<PrKey, string>> = {};
  for (const key of missing) {
    missingWhy[key] = problems.get(key) ?? 'left out of the answer';
  }
  return { glances: [...done.values()], missing, missingWhy };
}
