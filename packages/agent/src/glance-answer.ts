import type { Glance, IsoTime, PrKey } from '@code-manager/core';
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
}

/**
 * Checks every entry on its own, so one bad entry costs one PR, not the
 * batch. Entries for PRs not in the batch and repeats are dropped; whatever
 * the batch asked for and did not get validly is missing.
 */
export function mapGlanceAnswer(answer: GlanceBatchAnswer, input: GlanceBatchInput, stamp: GlanceStamp): MappedGlances {
  const items = new Map(input.items.map((item) => [item.pr.key, item]));
  const done = new Map<PrKey, Glance>();
  for (const entry of answer.glances) {
    const parsed = glanceBatchItemOutput.safeParse(entry);
    if (!parsed.success) {
      continue;
    }
    const value = parsed.data;
    const item = items.get(value.prKey);
    if (!item || done.has(value.prKey)) {
      continue;
    }
    done.set(value.prKey, {
      prKey: value.prKey,
      verdict: value.verdict,
      forYou: value.forYou,
      does: value.does,
      risk: value.risk,
      othersSaid: value.othersSaid,
      pullInReason: item.provenance.kind === 'pulled_in' ? item.provenance.reason : null,
      dossierVersion: input.dossier?.version ?? null,
      inputHash: stamp.inputHash(item),
      model: stamp.model,
      createdAt: stamp.createdAt,
    });
  }
  const missing = input.items.map((item) => item.pr.key).filter((key) => !done.has(key));
  return { glances: [...done.values()], missing };
}
