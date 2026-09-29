// The topic dossier and PR facts as plain text lines, shared by the dev CLI
// (pnpm cli topic|pr) and the MCP server, so both read the same.
import type { DossierIssue } from './memory.ts';
import type { DossierView, FactView, TopicChanges } from './memory-views.ts';

function day(iso: string): string {
  return iso.slice(0, 10);
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function staleMark(issues: DossierIssue[], path: string): string {
  const issue = issues.find((i) => i.path === path);
  return issue ? `  [stale: ${issue.reason}]` : '';
}

function formatChanges(changes: TopicChanges): string[] {
  const lines = [`since you last looked (${day(changes.since)}): ${plural(changes.newEvents, 'new event')}`];
  for (const change of changes.changes) {
    lines.push(`  - ${day(change.at)} ${change.text}`);
  }
  for (const fact of changes.factsAdded) {
    lines.push(`  + ${fact.text}`);
  }
  for (const fact of changes.factsClosed) {
    lines.push(`  x ${fact.text}${fact.invalidReason ? ` (${fact.invalidReason})` : ''}`);
  }
  return lines;
}

/** The dossier as plain text. PR state is not in the dossier; the tiles below show it. */
export function formatDossier(view: DossierView): string[] {
  const { dossier, staleClaims } = view;
  const behind = view.eventsBehind > 0 ? `, ${plural(view.eventsBehind, 'event')} not read yet` : '';
  const lines = [`dossier v${view.version} (${day(view.createdAt)}${behind})`];
  lines.push(`status: ${dossier.status}${dossier.statusNote ? ` - ${dossier.statusNote}` : ''}`);
  if (dossier.goal) {
    lines.push(`goal: ${dossier.goal}`);
  }
  if (dossier.people.length > 0) {
    lines.push(`people: ${dossier.people.map((p) => `@${p.login} ${p.role}${p.note ? ` (${p.note})` : ''}`).join(', ')}`);
  }
  for (const care of dossier.userCares) {
    lines.push(`you care: ${care.text} (${care.source})`);
  }
  dossier.openQuestions.forEach((question, i) => {
    const askedBy = question.askedBy ? ` (asked by @${question.askedBy})` : '';
    lines.push(`? ${question.text}${askedBy}${staleMark(staleClaims, `openQuestions[${i}]`)}`);
  });
  if (dossier.timeline.length > 0) {
    lines.push('timeline:');
    dossier.timeline.forEach((entry, i) => {
      lines.push(`  ${entry.prKey}: ${entry.role}${staleMark(staleClaims, `timeline[${i}]`)}`);
    });
  }
  if (dossier.earlier) {
    lines.push(`earlier: ${dossier.earlier}`);
  }
  if (dossier.recentChanges.length > 0) {
    lines.push('recent changes:');
    for (const change of dossier.recentChanges) {
      lines.push(`  ${day(change.at)} ${change.text}`);
    }
  }
  for (const flag of view.flags) {
    lines.push(`! ${flag.kind}: ${flag.text}${flag.prKey ? ` (${flag.prKey})` : ''}`);
  }
  if (view.changesSinceSeen) {
    lines.push(...formatChanges(view.changesSinceSeen));
  }
  return lines;
}

export function formatFacts(views: FactView[]): string[] {
  if (views.length === 0) {
    return [];
  }
  const lines = ['facts:'];
  for (const { fact, stale } of views) {
    const since = `since ${day(fact.validFrom)}`;
    lines.push(`  ${fact.text}  (${fact.predicate}, ${since}${stale ? `, stale: ${stale}` : ''})`);
  }
  return lines;
}
