// The "Unread since you looked" list in pr_context's full answer, a reading
// aid (DESIGN.md "Agents mark read"). People's comments, replies and
// reviews one by one with their whole text; bots, CI, pushes and repeated
// events without text folded per actor and kind into a count and a time
// range (core `unreadRows`).
import { unreadRows, type UnreadEvent, type UnreadRow } from '@postpile/core';
import { withActor } from './text.ts';

/** "2026-10-27 10:02". */
function stamp(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
}

function rangeText(from: string, to: string): string {
  return from === to ? stamp(from) : `${stamp(from)} – ${stamp(to)}`;
}

/** One row's lines; a body is one entry, since it can have tens of thousands of lines, too many to spread into push. */
function rowLines(row: UnreadRow): string[] {
  if (row.kind === 'folded') {
    return [`  ${row.actor}: ${row.count} ${row.what}, ${rangeText(row.from, row.to)}`];
  }
  const { event } = row;
  const head = `  ${stamp(event.at)}  ${withActor(event.actor, event.summary)}${event.isBot ? ' (bot)' : ''}`;
  if (event.body === null) {
    return [head];
  }
  return [head, event.body.split('\n').map((text) => `      ${text}`).join('\n')];
}

/** The section's lines, header first. Goes inside the fence: summaries, bodies and logins come from GitHub. */
export function unreadSectionLines(unread: UnreadEvent[]): string[] {
  if (unread.length === 0) {
    return ['Unread since you looked: nothing.'];
  }
  const lines = [`Unread since you looked (${unread.length} events, oldest first; people's text in full, bots, CI and pushes counted):`];
  for (const row of unreadRows(unread)) {
    for (const line of rowLines(row)) {
      lines.push(line);
    }
  }
  return lines;
}
