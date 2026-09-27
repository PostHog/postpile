import { z } from 'zod';

// What each prompt asks the model to answer with. The service maps these onto
// the domain types; ids the model invents are filtered out there.

const text = z.string().trim();
const loudness = z.enum(['loud', 'quiet', 'muted']);

export const glanceOutput = z.object({
  verdict: z.enum(['LOOKS_SAFE', 'LOOK_CLOSER', 'NOT_YOURS']),
  forYou: text,
  does: text,
  risk: text,
  othersSaid: text,
});

export const topicAssignmentOutput = z.object({
  assignments: z.array(
    z.discriminatedUnion('kind', [
      z.object({ prKey: text, kind: z.literal('existing'), topicId: text, reason: text }),
      z.object({ prKey: text, kind: z.literal('new'), name: text.min(1), reason: text }),
    ]),
  ),
});

export const setGroupingOutput = z.object({
  sets: z.array(
    z.object({
      title: text.min(1),
      take: text,
      members: z.array(z.object({ prKey: text, reason: text })),
    }),
  ),
});

export const topicSummaryOutput = z.object({
  summary: text.min(1),
  proposals: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('rename'), name: text.min(1), reason: text.min(1) }),
        z.object({ kind: z.literal('merge'), intoTopicId: text, reason: text.min(1) }),
      ]),
    )
    .default([]),
});

export const eventClassificationOutput = z.object({
  overrides: z.array(z.object({ eventId: text, loudness, reason: text.min(1) })),
});

export const draftCommentOutput = z.object({
  body: text.min(1),
});

export const chatOutput = z.object({
  reply: text.min(1),
  /** A lasting instruction worth keeping for the topic, or null. */
  tailoring: text.nullable(),
});

// ---------------------------------------------------------------------------
// Engine memory v2. Refs are the short ids the prompt handed out ("e12" for an
// event, "pr3" for a PR); the service maps them back to FactRefs and drops
// unknown ones.
// ---------------------------------------------------------------------------

const refIds = z.array(text).default([]);

const entity = z.object({
  kind: z.enum(['person', 'path', 'initiative', 'pr']),
  key: text.min(1),
});

const predicate = z.enum([
  'drives',
  'works_on',
  'reviews',
  'owns',
  'part_of',
  'depends_on',
  'blocked_by',
  'decided',
  'status',
  'user_cares',
  'note',
]);

/** Lengths are not enforced here: one long field must not throw away a whole update. clampDossier cuts. */
export const dossierOutput = z.object({
  goal: text,
  summary: text.min(1),
  status: z.enum(['starting', 'active', 'blocked', 'winding_down', 'finished']),
  statusNote: text.default(''),
  people: z
    .array(z.object({ login: text.min(1), role: z.enum(['driver', 'contributor', 'reviewer', 'stakeholder']), note: text }))
    .default([]),
  openQuestions: z.array(z.object({ text: text.min(1), askedBy: text.nullable(), refs: refIds })).default([]),
  timeline: z.array(z.object({ prKey: text, role: text })).default([]),
  earlier: text.default(''),
  userCares: z
    .array(z.object({ text: text.min(1), source: z.enum(['instructions', 'tailoring', 'feedback', 'observed']) }))
    .default([]),
  recentChanges: z.array(z.object({ at: text, text: text.min(1), refs: refIds })).default([]),
});

export const dossierUpdateOutput = z.object({
  dossier: dossierOutput,
  flags: z
    .array(
      z.object({
        kind: z.enum(['needs_user', 'contradiction', 'looks_finished', 'off_topic_pr']),
        text: text.min(1),
        prKey: text.nullable(),
      }),
    )
    .default([]),
  facts: z
    .array(z.object({ subject: entity, predicate, object: entity.nullable(), text: text.min(1), refs: refIds }))
    .default([]),
  closeFacts: z.array(z.object({ factId: text, reason: text.min(1) })).default([]),
  confirmedFactIds: z.array(text).default([]),
});

/** item is the 0-based index into FactReconcileInput.items. */
export const factReconcileOutput = z.object({
  decisions: z.array(
    z.object({
      item: z.number().int().min(0),
      action: z.enum(['add', 'update', 'invalidate', 'noop']),
      /** Required for update, invalidate and noop: one of the item's existing facts. */
      factId: text.nullable(),
      reason: text,
    }),
  ),
});

/**
 * The outer shape only. Each entry is checked on its own with
 * glanceBatchItemOutput so one bad entry costs one PR, not the batch.
 */
export const glanceBatchOutput = z.object({
  glances: z.array(z.unknown()),
});

export const glanceBatchItemOutput = glanceOutput.extend({
  prKey: text,
});

/** Same shape as the single-PR answer; event ids are unique across the batch. */
export const eventBatchOutput = eventClassificationOutput;

export const consolidationOutput = z.object({
  topicProposals: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('rename'), topicId: text, name: text.min(1), reason: text.min(1) }),
        z.object({ kind: z.literal('merge'), topicId: text, intoTopicId: text, reason: text.min(1) }),
        z.object({ kind: z.literal('split'), topicId: text, name: text.min(1), prKeys: z.array(text).min(1), reason: text.min(1) }),
      ]),
    )
    .default([]),
  factMerges: z.array(z.object({ keepId: text, dropIds: z.array(text).min(1), reason: text })).default([]),
  rules: z
    .array(z.object({ text: text.min(1), topicId: text.nullable(), evidenceFeedbackIds: z.array(z.number().int()), reason: text }))
    .default([]),
  finished: z.array(z.object({ topicId: text, reason: text.min(1) })).default([]),
});
