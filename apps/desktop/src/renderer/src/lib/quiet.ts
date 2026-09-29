import type { QuietReadView, QuietReason } from '@postpile/core';

/** "trunk-io" for "trunk-io[bot]": the suffix only says it is an app account, which every name here is. */
export function botLabel(name: string): string {
  return name.replace(/\[bot\]$/, '');
}

/** "trunk-io, CI", or a neutral word when the log named none. */
export function botsText(bots: string[]): string {
  return bots.length === 0 ? 'bots' : bots.map(botLabel).join(', ');
}

/** "acme/app#1904". */
export function quietRef(item: QuietReadView): string {
  return `${item.repo}#${item.number}`;
}

/** Why PostPile marked it read, for every reason but bots. */
const REASON_TEXT: Record<Exclude<QuietReason, 'bots'>, string> = {
  approved: 'you approved after it',
  changes_requested: 'you requested changes after it',
  reviewed: 'you reviewed after it',
  replied: 'you replied after it',
  opened: 'opened in PostPile',
};

/** "only trunk-io, CI", "you approved after it", "opened in PostPile". */
export function quietReasonText(item: Pick<QuietReadView, 'reason' | 'bots'>): string {
  return item.reason === 'bots' ? `only ${botsText(item.bots)}` : REASON_TEXT[item.reason];
}
