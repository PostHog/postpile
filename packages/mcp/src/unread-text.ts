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

/** The body cut to `max` characters with "… (cut)"; whole when `max` is null. */
function clippedBody(body: string, max: number | null): string {
  return max === null || body.length <= max ? body : `${body.slice(0, max)}… (cut)`;
}

/** One row's lines; a body is one entry, since it can have tens of thousands of lines, too many to spread into push. */
function rowLines(row: UnreadRow, bodyMax: number | null): string[] {
  if (row.kind === 'folded') {
    return [`  ${row.actor}: ${row.count} ${row.what}, ${rangeText(row.from, row.to)}`];
  }
  const { event } = row;
  const head = `  ${stamp(event.at)}  ${withActor(event.actor, event.summary)}${event.isBot ? ' (bot)' : ''}`;
  if (event.body === null) {
    return [head];
  }
  return [head, clippedBody(event.body, bodyMax).split('\n').map((text) => `      ${text}`).join('\n')];
}

/**
 * The section's lines, header first. Goes inside the fence: summaries,
 * bodies and logins come from GitHub. `bodyMax` clips each body when
 * several PRs share one answer's size budget; null keeps them whole.
 */
export function unreadSectionLines(unread: UnreadEvent[], bodyMax: number | null = null): string[] {
  if (unread.length === 0) {
    return ['Unread since you looked: nothing.'];
  }
  const text = bodyMax === null ? "people's text in full" : `people's text up to ${bodyMax} characters each`;
  const lines = [`Unread since you looked (${unread.length} events, oldest first; ${text}, bots, CI and pushes counted):`];
  for (const row of unreadRows(unread)) {
    for (const line of rowLines(row, bodyMax)) {
      lines.push(line);
    }
  }
  return lines;
}
