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
