import type {
  DossierCare,
  DossierChange,
  DossierIssue,
  DossierStatus,
  DossierView,
  FactRef,
  FactView,
  MemoryRecheckRequest,
  StaleReason,
} from '@postpile/core';
import { prNumber } from './tiles.ts';

const STATUS_LABELS: Record<DossierStatus, string> = {
  starting: 'Starting',
  active: 'Active',
  blocked: 'Blocked',
  winding_down: 'Winding down',
  finished: 'Finished',
};

const STALE_LABELS: Record<StaleReason, string> = {
  pr_missing: 'PR not synced',
  pr_closed: 'PR closed since',
  pr_merged: 'PR merged since',
  head_moved: 'PR moved since',
  person_not_involved: 'no longer involved',
  source_deleted: 'source deleted',
  thread_resolved: 'thread resolved',
  left_topic: 'left the topic',
};

/** Recent changes shown when the topic was never marked seen. */
const RECENT_WHEN_NEVER_SEEN = 3;

export function statusLabel(status: DossierStatus): string {
  return STATUS_LABELS[status];
}

export function staleLabel(reason: StaleReason): string {
  return STALE_LABELS[reason];
}

/** "#1902", "#1902 comment", "#1902 review", ... */
export function refLabel(ref: FactRef): string {
  const number = `#${prNumber(ref.prKey)}`;
  return ref.kind === 'pr' || ref.kind === 'event' ? number : `${number} ${ref.kind}`;
}

/** Two refs draw the same chip when they show the same label and lead to the same place. */
function chipKey(ref: FactRef): string {
  return `${refLabel(ref)}|${ref.url ?? ''}`;
}

/**
 * The source chips per line of one block (the since-you-looked list, open
 * questions, a PR's facts): a chip already shown on an earlier line, or
 * earlier on the same line, is left out, so "#1902" does not repeat down
 * the block. Same order and length as `lines`.
 */
export function blockRefs(lines: { refs: FactRef[] }[]): FactRef[][] {
  const shown = new Set<string>();
  return lines.map((line) =>
    line.refs.filter((ref) => {
      const key = chipKey(ref);
      if (shown.has(key)) {
        return false;
      }
      shown.add(key);
      return true;
    }),
  );
}

/** Why a dossier claim at `path` (e.g. "openQuestions[2]") failed verification, if it did. */
export function claimStaleReason(path: string, issues: DossierIssue[]): StaleReason | null {
  return issues.find((issue) => issue.path === path)?.reason ?? null;
}

/** One count on the heading row: the number is drawn in mono, the words after it plain. */
export interface SinceCount {
  count: number;
  words: string;
}

export interface SinceLastLooked {
  heading: string;
  changes: DossierChange[];
  /** Counts on the heading row, e.g. 3 "new events", 2 "facts learned". Empty when nothing to add. */
  counts: SinceCount[];
}

function countOf(count: number, one: string, many: string): SinceCount {
  return { count, words: count === 1 ? one : many };
}

/**
 * The "Since you last looked" block. A topic never marked seen has no cursor,
 * so it shows the newest few recent changes instead.
 */
export function sinceLastLooked(view: DossierView): SinceLastLooked {
  const seen = view.changesSinceSeen;
  if (!seen) {
    return { heading: 'Recent changes', changes: view.dossier.recentChanges.slice(0, RECENT_WHEN_NEVER_SEEN), counts: [] };
  }
  const counts: SinceCount[] = [];
  if (seen.newEvents > 0) {
    counts.push(countOf(seen.newEvents, 'new event', 'new events'));
  }
  if (seen.factsAdded.length > 0) {
    counts.push(countOf(seen.factsAdded.length, 'fact learned', 'facts learned'));
  }
  if (seen.factsClosed.length > 0) {
    counts.push(countOf(seen.factsClosed.length, 'fact closed', 'facts closed'));
  }
  return { heading: 'Since you last looked', changes: seen.changes, counts };
}

/**
 * A change line that starts with one of the topic's people ("lyra asked
 * ...") split into that login and the rest, so the name can be set in
 * ink; null when it starts with anything else.
 */
export function leadingPerson(text: string, logins: string[]): { login: string; rest: string } | null {
  const login = logins.find((candidate) => candidate !== '' && text.startsWith(`${candidate} `));
  return login ? { login, rest: text.slice(login.length) } : null;
}

/** The corrected text of a line the user fixed through Recheck, newest fix first; null when not fixed. */
export function fixedText(view: DossierView, text: string): string | null {
  return view.fixedClaims.find((claim) => claim.text === text)?.fixed ?? null;
}

/**
 * A care's source after its text. An observed care is not kept as a rule;
 * "unconfirmed" read like "you never said it", even for a care taken from
 * the user's own chat.
 */
export function careText(care: DossierCare): string {
  if (care.source !== 'observed') {
    return `${care.text} (${care.source})`;
  }
  const fromChat = (care.userRefs ?? []).some((ref) => ref.kind === 'chat');
  return `${care.text} (${fromChat ? 'from your chat' : 'noticed, not kept as a rule'})`;
}

/** Big claims get Recheck, and so does any fact while it is stale: the app says it may be wrong, so the user can check it. */
export function canRecheckFact(view: FactView): boolean {
  return view.recheckable || view.stale !== null;
}

const RECHECK_LINE_NAMES: Record<string, string> = {
  status: 'topic status',
  goal: 'topic goal',
  openQuestions: 'open question',
  timeline: 'PR timeline entry',
  userCares: 'what you care about',
  people: 'person',
  recentChanges: 'recent change',
  relation: 'why this reaches you',
};

/** The Recheck dialog's title, naming what is checked: a screen can hold several Recheck links. */
export function recheckTitle(request: MemoryRecheckRequest): string {
  if (request.prKey) {
    return `Recheck #${prNumber(request.prKey)}'s assessment`;
  }
  if (request.factId !== null) {
    return 'Recheck fact';
  }
  const path = request.target?.kind === 'dossier_line' ? request.target.path : '';
  const name = RECHECK_LINE_NAMES[path.replace(/\[\d+\]$/, '')];
  return name ? `Recheck ${name}` : 'Recheck topic memory';
}

/** The engine's Unsorted pseudo-topic (`UNSORTED_TOPIC_ID`): not a topic yet, so it never gets a dossier. */
const UNSORTED_TOPIC_ID = 'unsorted';

/** "No dossier yet" under the topic summary: a real topic before its first dossier update. */
export function awaitsDossier(topicId: string, dossier: DossierView | null): boolean {
  return dossier === null && topicId !== UNSORTED_TOPIC_ID;
}
