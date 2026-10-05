import { useState } from 'react';
import type { ActivityLine, PrDetail } from '@postpile/core';
import { whenLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { newSinceAnchor } from '../lib/whats-new.ts';
import { eventRow, lineRow, linkButton } from './ActivityTimeline.tsx';
import { useCompose } from './Composer.tsx';

/** Loud lines shown before "N more". */
const LINES_SHOWN = 3;

/**
 * "New since you looked", right under the title: the loud lines since the
 * viewer's last touch (same rows as the activity list), anchored to that
 * touch ("since your changes request yesterday"), and the quiet bot and CI
 * events of that stretch folded into one line. Only while something loud is new.
 * A digest you read: a person's comment that can take a reply gets "Reply ↓",
 * which scrolls to it in the activity list and opens the reply there.
 */
export function NewSinceBox(props: { detail: PrDetail }) {
  const now = useNow();
  const compose = useCompose();
  function replyLink(line: ActivityLine) {
    const target = line.reply;
    if (!target?.canReply) {
      return null;
    }
    return (
      <button
        type="button"
        title="Scrolls to the comment in Activity and opens the reply there"
        onClick={() => compose.jumpToReply(target.commentId)}
        className="mt-0.5 block text-[11.5px] font-medium text-accent hover:underline"
      >
        Reply ↓
      </button>
    );
  }
  const [showAll, setShowAll] = useState(false);
  const [showNoise, setShowNoise] = useState(false);
  const { fresh, freshNoise, freshNoiseLabel } = props.detail.activity;
  const news = props.detail.whatsNew;
  if (fresh.length === 0) {
    return null;
  }
  const anchor = newSinceAnchor(news, news ? whenLabel(news.anchor.at, now) : null);
  const shown = showAll ? fresh : fresh.slice(0, LINES_SHOWN);
  const hidden = fresh.length - shown.length;
  return (
    <div className="flex flex-col rounded-box bg-unread-row px-3 pt-[11px] pb-1.5 inset-ring inset-ring-unread-border">
      <span className="pb-1.5 text-[10.5px] font-semibold text-unread-ink">
        <span className="tracking-[0.04em] uppercase">New since you looked</span>
        {anchor && <span className="font-medium"> · {anchor}</span>}
      </span>
      {shown.map((line, index) => lineRow(line, index === shown.length - 1, replyLink(line)))}
      {hidden > 0 && (
        <button type="button" className={linkButton} onClick={() => setShowAll(true)}>
          {hidden} more
        </button>
      )}
      {freshNoise.length > 0 && (
        <div className="flex flex-col">
          <button type="button" aria-expanded={showNoise} className={`${linkButton} text-muted`} onClick={() => setShowNoise(!showNoise)}>
            {showNoise ? `Hide ${freshNoiseLabel}` : freshNoiseLabel}
          </button>
          {showNoise && <div className="mt-2 flex flex-col">{freshNoise.map((view, index) => eventRow(view, index === freshNoise.length - 1))}</div>}
        </div>
      )}
    </div>
  );
}
