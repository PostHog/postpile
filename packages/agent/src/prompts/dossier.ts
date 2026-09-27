import type { CheckRollup, DossierCare, DossierQuestion, DossierVersion, Pr, PrKey } from '@code-manager/core';

const ciWords: Record<CheckRollup, string> = {
  SUCCESS: 'CI passing',
  FAILURE: 'CI failing',
  PENDING: 'CI running',
  NONE: '',
};

/** Where a PR stands right now, from its snapshot. Never from memory. */
export function prStateWords(pr: Pr): string {
  if (pr.state === 'MERGED') {
    return `merged, @${pr.author}`;
  }
  if (pr.state === 'CLOSED') {
    return `closed unmerged, @${pr.author}`;
  }
  const state = pr.isDraft ? 'draft' : 'open';
  return [state, ciWords[pr.checks.rollup], `@${pr.author}`].filter(Boolean).join(', ');
}

function questionLine(question: DossierQuestion, index: number): string {
  const sources = [...new Set(question.refs.map((ref) => ref.prKey))];
  const about = [question.askedBy ? `asked by @${question.askedBy}` : '', ...sources].filter(Boolean).join(', ');
  return `- Q${index + 1} ${question.text}${about ? ` (${about})` : ''}`;
}

/** An observed care was inferred from activity, which anyone on GitHub can write. */
function careLine(care: DossierCare): string {
  const source = care.source === 'observed' ? 'observed, unconfirmed' : care.source;
  return `- ${care.text} (${source})`;
}

function section(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : [title, ...lines];
}

/**
 * The dossier as prompt text. PR state, author and CI come from `prs` (the
 * current snapshots), never from the stored dossier, so a prompt cannot
 * carry a stale state line. Stays under ~8k chars given DOSSIER_LIMITS.
 * Layout in DESIGN.md "Dossier as prompt text". Questions and changes carry
 * Q1 / C1 labels so a dossier update can cite them to keep their sources.
 */
export function renderDossier(version: DossierVersion, prs: Map<PrKey, Pr>): string {
  const d = version.dossier;
  const status = d.statusNote ? `${d.status} - ${d.statusNote}` : d.status;
  const timeline = d.timeline.map((entry) => {
    const pr = prs.get(entry.prKey);
    return `- ${entry.prKey}${pr ? ` ${prStateWords(pr)}` : ''}: ${entry.role}`;
  });
  const lines = [
    `Topic dossier (v${version.version}, written ${version.createdAt.slice(0, 10)})`,
    `Goal: ${d.goal || '(unknown)'}`,
    `Status: ${status}`,
    `Summary: ${d.summary}`,
    ...section(
      'People:',
      d.people.map((p) => `- @${p.login} ${p.role}${p.note ? `: ${p.note}` : ''}`),
    ),
    ...section('What the user cares about here:', d.userCares.map(careLine)),
    ...section('Open questions:', d.openQuestions.map(questionLine)),
    ...section('PR timeline, oldest first (state from GitHub now, not from memory):', timeline),
    ...(d.earlier ? [`Earlier: ${d.earlier}`] : []),
    ...section(
      'Recent changes, newest first:',
      d.recentChanges.map((c, index) => `- C${index + 1} ${c.at.slice(0, 10)} ${c.text}`),
    ),
  ];
  return lines.join('\n');
}
