import type { QuietReadView } from '@postpile/core';

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
