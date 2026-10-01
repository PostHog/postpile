import { z } from 'zod';

// What each prompt asks the model to answer with. The service maps these onto
// the domain types; ids the model invents are filtered out there.

const text = z.string().trim();
const loudness = z.enum(['loud', 'quiet', 'muted']);

/**
 * Reads a verdict the model spelled wrong. Seen on real PRs, reproducibly
 * for the same PR: "LOOKS_SASAFE", "LOOKS_SASE". Only unambiguous spellings
 * are repaired, and anything that mentions closer wins over safe, so a
 * garbled answer can never turn a "look closer" into "looks safe".
 * Everything else is returned as it came and fails the enum.
 */
export function repairVerdict(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }
  const letters = value.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.includes('CLOSE')) {
    return 'LOOK_CLOSER';
  }
  if (letters.startsWith('NOTY') || letters.includes('YOURS')) {
    return 'NOT_YOURS';
  }
  if (letters.startsWith('LOOKSS')) {
    return 'LOOKS_SAFE';
  }
  return value;
}

const glanceOutput = z.object({
  verdict: z.preprocess(repairVerdict, z.enum(['LOOKS_SAFE', 'LOOK_CLOSER', 'NOT_YOURS'])),
  forYou: text,
  does: text,
  risk: text,
  othersSaid: text,
  /** Paths are checked against the PR's changed files in mapGlanceAnswer. */
  keyFiles: z.array(z.object({ path: text.min(1), why: text.default('') })).default([]),
});

/** project: has a finish line. standing: a standard kept up with no end (core TopicKind). Missing or unknown reads as a project. */
const topicKind = z.enum(['project', 'standing']).catch('project');

export const topicAssignmentOutput = z.object({
  assignments: z.array(
    z.discriminatedUnion('kind', [
      z.object({ prKey: text, kind: z.literal('existing'), topicId: text, reason: text }),
      z.object({ prKey: text, kind: z.literal('new'), name: text.min(1), goal: text.default(''), topicKind, reason: text }),
      // No longer asked for. Still parsed so one such entry does not fail the
      // whole batch; the service drops it and the engine asks again.
      z.object({ prKey: text, kind: z.literal('unsorted'), reason: text.default('') }),
    ]),
  ),
});

export const topicTidyOutput = z.object({
  merges: z
    .array(z.object({ fromTopicIds: z.array(text), intoTopicId: text, name: text.nullable().default(null), reason: text.min(1) }))
    .default([]),
  splits: z
    .array(
      z.object({
        topicId: text,
        prKeys: z.array(text),
        intoTopicId: text.nullable().default(null),
        newName: text.nullable().default(null),
        newKind: topicKind,
        reason: text.min(1),
      }),
    )
    .default([]),
  renames: z.array(z.object({ topicId: text, name: text.min(1), reason: text.min(1) })).default([]),
  kinds: z.array(z.object({ topicId: text, kind: topicKind })).default([]),
});

/** Only what changes: anything the answer leaves out stays as it is. */
export const setGroupingOutput = z.object({
  newSets: z
    .array(
      z.object({
        title: text.min(1),
        take: text,
        members: z.array(z.object({ prKey: text, reason: text })),
      }),
    )
    .default([]),
  joins: z.array(z.object({ setId: text, prKey: text, reason: text })).default([]),
  leaves: z.array(z.object({ setId: text, prKey: text, reason: text.min(1) })).default([]),
  merges: z.array(z.object({ setId: text, intoSetId: text, reason: text.min(1) })).default([]),
  updates: z.array(z.object({ setId: text, title: text.min(1), take: text })).default([]),
});

export const draftCommentOutput = z.object({
  body: text.min(1),
});

export const chatOutput = z.object({
  reply: text.min(1),
  /** A lasting instruction worth keeping, or null. The user picks where it applies. */
  lasting: z.object({ text: text.min(1) }).nullable().default(null),
});

export const memoryRecheckOutput = z.object({
  outcome: z.enum(['holds', 'fix', 'drop']),
  text: text.default(''),
  why: text.min(1),
});

export const pingDecisionOutput = z.object({
  decisions: z.array(
    z.object({
      id: text,
      ping: z.boolean(),
      title: text.default(''),
      body: text.default(''),
      reason: text.default(''),
    }),
  ),
});

export const contextSweepOutput = z.object({
  summary: text.min(1),
  threads: z
    .array(
      z.object({
        title: text.min(1),
        detail: text.default(''),
        topicIds: z.array(text).default([]),
        /** Item ids from the prompt ("m3", "s7"). */
        sources: z.array(text).default([]),
      }),
    )
    .default([]),
  lastSeenAt: text.nullable().optional(),
});

const setupRepoPick = z.object({ repo: text.min(1), why: text.default(''), sources: z.array(text).default([]) });

/** The setup draft. Source ids ("p3", "o1", "d1", "t2") and repos are checked by mapSetupDraft. */
export const setupDraftOutput = z.object({
  summary: text.default(''),
  sections: z
    .array(
      z.object({
        heading: text.min(1),
        claims: z.array(z.object({ text: text, sources: z.array(text).default([]) })).default([]),
      }),
    )
    .default([]),
  quietRepos: z.array(setupRepoPick).default([]),
  mainRepo: setupRepoPick.nullable().default(null),
});

export const setupRefineOutput = setupDraftOutput.extend({ reply: text.default('') });

/** Setup's fit check. Kinds, lines and headings are checked against the user's text by mapSetupFit. */
export const setupFitOutput = z.object({
  notes: z
    .array(
      z.object({
        heading: text.default(''),
        line: text,
        kind: text,
        why: text.default(''),
        moveTo: text.nullable().default(null),
        rewrite: text.nullable().default(null),
      }),
    )
    .default([]),
});

export const instructionsChangeOutput = z.object({
  reply: text.default(''),
  change: z.object({ text: text.min(1), summary: text.min(1) }).nullable(),
});

// ---------------------------------------------------------------------------
// Engine memory v2. Refs are the short ids the prompt handed out ("e12" for an
// event, a PR key, "I1" / "T2" / "U3" / "M4" for the user's own words); the
// service maps them back to sources and drops unknown ones.
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

/**
 * Lengths are not enforced here: one long field must not throw away a whole
 * update. clampDossier cuts. Fields the dossier can live without are
 * defaulted or caught the same way: a real sync lost a whole update to one
 * question without "askedBy".
 */
export const dossierOutput = z.object({
  goal: text.default(''),
  goalRefs: refIds,
  summary: text.min(1),
  status: z.enum(['starting', 'active', 'blocked', 'winding_down', 'finished']).catch('active'),
  statusNote: text.default(''),
  statusRefs: refIds,
  people: z
    .array(
      z.object({
        login: text.min(1),
        role: z.enum(['driver', 'contributor', 'reviewer', 'stakeholder']).catch('contributor'),
        note: text.default(''),
      }),
    )
    .default([]),
  openQuestions: z.array(z.object({ text: text.min(1), askedBy: text.nullable().default(null), refs: refIds })).default([]),
  timeline: z.array(z.object({ prKey: text, role: text.default(''), refs: refIds })).default([]),
  earlier: text.default(''),
  userCares: z
    .array(
      z.object({
        text: text.min(1),
        // Unknown sources count as observed, which the UI shows as unconfirmed.
        source: z.enum(['instructions', 'tailoring', 'feedback', 'observed']).catch('observed'),
        refs: refIds,
      }),
    )
    .default([]),
  // at is ignored: the service stamps new entries itself. Older prompts asked for it.
  recentChanges: z.array(z.object({ at: text.optional(), text: text.min(1), refs: refIds })).default([]),
  relation: z
    .object({
      kind: z.enum(['team', 'routed', 'fyi']),
      ownerTeam: text.nullable().default(null),
      whyYou: text.default(''),
      refs: refIds,
    })
    .nullable()
    .catch(null)
    .default(null),
});

export const dossierUpdateOutput = z.object({
  dossier: dossierOutput,
  flags: z
    .array(
      z.object({
        kind: z.enum(['needs_user', 'contradiction', 'looks_finished', 'off_topic_pr']),
        text: text.min(1),
        prKey: text.nullable().default(null),
      }),
    )
    .default([]),
  facts: z
    .array(z.object({ subject: entity, predicate, object: entity.nullable().default(null), text: text.min(1), refs: refIds }))
    .default([]),
  closeFacts: z.array(z.object({ factId: text, reason: text.default('closed by the dossier update') })).default([]),
  confirmedFactIds: z.array(text).default([]),
  area: text.nullable().catch(null).default(null),
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

/**
 * The dossier answer plus the glances and the set changes. Each glance is
 * checked on its own, like a glance batch; the set part is checked on its
 * own too, so a broken one never costs the dossier.
 */
export const topicDigestOutput = dossierUpdateOutput.extend({
  glances: z.array(z.unknown()).default([]),
  sets: z.unknown().optional(),
});

export const glanceBatchItemOutput = glanceOutput.extend({
  prKey: text,
});

/** Only the events the rules got wrong. Event ids are unique across the batch. */
export const eventBatchOutput = z.object({
  overrides: z.array(z.object({ eventId: text, loudness, reason: text.min(1) })),
});

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
  areaMerges: z.array(z.object({ from: text.min(1), into: text.min(1), reason: text.default('') })).default([]),
  rules: z
    .array(z.object({ text: text.min(1), topicId: text.nullable(), evidenceFeedbackIds: z.array(z.number().int()), reason: text }))
    .default([]),
  finished: z.array(z.object({ topicId: text, reason: text.min(1) })).default([]),
});
