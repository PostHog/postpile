import type { TopicDetail } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { whenLabel } from '../lib/time.ts';
import { Button } from './Button.tsx';

/** "Fri 3 Oct": when the topic goes, or stops taking PRs. */
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The Archive box in the topic's action row, under the Tiles count (DESIGN
 * "The Archive"). With nothing left in the topic it says when the topic
 * moves to the Archive by itself and offers "Archive now"; in the Archive it
 * says since when and what brings it back. Gone while anything is open or
 * unread.
 */
export function TopicArchiveBox(props: { detail: TopicDetail }) {
  const actions = useActions();
  const box = props.detail.archive;
  if (!box) {
    return null;
  }
  const topicId = props.detail.topic.id;
  const standing = props.detail.topic.kind === 'standing';
  const now = new Date();
  if (box.state === 'archived') {
    const keeps = standing ? `As a standing topic it waits for its next PR until ${dayLabel(box.until)}.` : `It takes follow-up PRs until ${dayLabel(box.until)}.`;
    return (
      <p className="rounded-tile border border-hairline-strong bg-surface px-3.5 py-2.5 text-xs leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">In the Archive since {whenLabel(box.at, now)}.</span> It comes back when a PR joins or a thread turns unread. {keeps}
      </p>
    );
  }
  const busyKey = `archiveTopic:${topicId}`;
  const when = new Date(box.at) <= now ? 'with the next sync' : `by itself on ${dayLabel(box.at)}`;
  return (
    <div className="flex items-center gap-3.5 rounded-tile border border-hairline-strong bg-surface px-3.5 py-2.5">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-2">
        <span className="font-semibold text-ink">Everything here is dealt with.</span> Every PR is merged or closed and every thread read. It moves to the
        Archive {when}.
      </p>
      <Button variant="primary" disabled={actions.isBusy(busyKey)} onClick={() => void actions.archiveTopic(topicId)}>
        Archive now
      </Button>
    </div>
  );
}
