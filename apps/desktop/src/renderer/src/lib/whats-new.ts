import type { WhatsNew, WhatsNewAnchor, WhatsNewAnchorKind } from '@postpile/core';
import { plural } from './plural.ts';

/** The strip has room for about this many characters next to the avatar, NEW pill and age. */
export const STRIP_TEXT_MAX = 48;

const ANCHOR_SINCE: Record<WhatsNewAnchorKind, string> = {
  changes_request: 'since your changes request',
  approval: 'since you approved',
  review: 'since your review',
  comment: 'since your comment',
  push: 'since your push',
  merge: 'since you merged it',
  close: 'since you closed it',
  read: 'since you marked it read',
};

/** What the viewer's review or comment is called in "replied to your ...". */
const REPLY_NOUN: Record<WhatsNewAnchorKind, string | null> = {
  changes_request: 'review',
  approval: 'review',
  review: 'review',
  comment: 'comment',
  push: null,
  merge: null,
  close: null,
  read: null,
};

/** "since your changes request", "since you marked it read". */
export function anchorSince(anchor: WhatsNewAnchor): string {
  return ANCHOR_SINCE[anchor.kind];
}

/** A lead line and a shorter one without the anchor, for when the long one does not fit. */
function leadLines(news: WhatsNew): { long: string; short: string } {
  const { lead, anchor } = news;
  const since = anchorSince(anchor);
  const withSince = (text: string) => ({ long: `${text} ${since}`, short: text });
  const reviewed = anchor.kind === 'changes_request' || anchor.kind === 'approval' || anchor.kind === 'review';
  switch (lead.kind) {
    case 'mention':
      return withSince(`${lead.actor} mentioned you`);
    case 'team_mention':
      return withSince(`${lead.actor} mentioned your team`);
    case 'question':
      return withSince(`${lead.actor} asked you`);
    case 'reply': {
      const noun = REPLY_NOUN[anchor.kind];
      return noun ? { long: `${lead.actor} replied to your ${noun}`, short: `${lead.actor} replied` } : withSince(`${lead.actor} commented`);
    }
    case 'review_request':
      return reviewed ? { long: `${lead.actor} re-requested your review`, short: `${lead.actor} re-requested review` } : withSince(`${lead.actor} requested your review`);
    case 'changes_requested':
      return withSince(`${lead.actor} requested changes`);
    case 'approved':
      return withSince(`${lead.actor} approved`);
    case 'push':
      if (anchor.kind === 'approval') {
        const text = lead.count === 1 ? 'pushed after your approval' : `${plural(lead.count, 'commit')} after your approval`;
        return { long: text, short: text };
      }
      return withSince(lead.count === 1 ? `${lead.actor} pushed` : plural(lead.count, 'commit'));
    case 'other':
      return withSince(lead.summary);
  }
}

/**
 * The why-now strip's text on a revisit: the most important new thing,
 * anchored to what the viewer last did ("6 commits since your changes
 * request", "lyra replied to your review"). Falls back to the short form
 * when the long one would not fit.
 */
export function whatsNewText(news: WhatsNew): string {
  const lines = leadLines(news);
  if (lines.long.length <= STRIP_TEXT_MAX) {
    return lines.long;
  }
  return lines.short;
}

/**
 * The anchor part of the "New since you looked" header: "since your changes
 * request yesterday". Null on a first look, where the header stays plain.
 */
export function newSinceAnchor(news: WhatsNew | null, when: string | null): string | null {
  if (!news) {
    return null;
  }
  const since = anchorSince(news.anchor);
  return when ? `${since} ${when}` : since;
}
