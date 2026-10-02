import { useState } from 'react';
import type { InstructionsProposalReply, LessonView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { proposalKey } from '../lib/instructions.ts';
import { earlierAssessmentText, lessonSource } from '../lib/lessons.ts';
import { Button } from './Button.tsx';
import { InstructionsProposalCard } from './InstructionsProposalCard.tsx';

/**
 * One lesson for the user to decide on (DESIGN.md "Lessons from your
 * reviews"): the line, where it came from and what the glance said before,
 * then Remember in this topic / Use across topics… / Dismiss. Nothing
 * changes until a click. "Use across topics…" asks for an instructions
 * proposal and shows its diff right here; a reply without one shows as text.
 * Calm on purpose: neutral, never coral, honey or accent.
 */
/** heading false: a list above already says it (TopicLessons). */
export function LessonCard(props: { lesson: LessonView; onDecided?: () => void; heading?: boolean }) {
  const actions = useActions();
  const { lesson } = props;
  const [reply, setReply] = useState<InstructionsProposalReply | null>(null);
  const busy = actions.isBusy(`lesson:${lesson.id}`);
  const source = lessonSource(lesson);
  const earlier = earlierAssessmentText(lesson);

  async function keepForTopic() {
    if (await actions.keepLessonForTopic(lesson.id)) {
      props.onDecided?.();
    }
  }

  async function dismiss() {
    if (await actions.dismissLesson(lesson.id)) {
      props.onDecided?.();
    }
  }

  async function proposeAcrossTopics() {
    setReply(await actions.proposeInstructionsFromLesson(lesson.id));
  }

  /** Accept keeps the lesson for all topics (the server closes it); Reject only folds the diff away. */
  function proposalDone(accepted: boolean) {
    setReply(null);
    if (accepted) {
      props.onDecided?.();
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-row bg-subtle px-3 pt-2.5 pb-3 text-xs inset-ring inset-ring-edge-hairline">
      {props.heading !== false && <span className="font-semibold text-ink">Remember for future assessments?</span>}
      <span className="text-[12.5px] leading-[1.45] text-pretty text-ink select-text">“{lesson.text}”</span>
      <span className="text-[11.5px] text-hint" title={lesson.prTitle}>
        {source.before}
        <span className="font-mono text-[10.5px]">{source.pr}</span>
        {source.after}
        {earlier && <span className="text-faint"> · </span>}
        {earlier}
      </span>
      <div className="flex flex-wrap gap-1.5">
        <Button
          disabled={busy || lesson.topicId === null}
          title={lesson.topicId === null ? 'Its PR is not in a topic yet, so there is no topic to keep it on' : 'Add the line to what you told the agent in this topic'}
          onClick={() => void keepForTopic()}
        >
          Remember in this topic
        </Button>
        <Button disabled={busy} title="Propose it as a change to your general instructions, shown as a diff first" onClick={() => void proposeAcrossTopics()}>
          Use across topics…
        </Button>
        <Button disabled={busy} title="Drop it; the agent does not offer it again" onClick={() => void dismiss()}>
          Dismiss
        </Button>
      </div>
      {reply?.proposal && <InstructionsProposalCard key={proposalKey(reply.proposal)} proposal={reply.proposal} onDone={proposalDone} />}
      {reply && !reply.proposal && <p className="text-[11.5px] text-ink-2">{reply.reply || 'That does not change your instructions.'}</p>}
    </div>
  );
}
