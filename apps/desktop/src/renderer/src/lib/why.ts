import type { ForWhom, Provenance, TilePersonRole, WhoseTurn, WhyCode } from '@postpile/core';

/** The long reason behind each why-here code, for the "for whom" chip's tooltip. */
const WHY_LABELS: Record<WhyCode, string> = {
  RV: 'Review asked of you',
  RT: 'Review asked of your team',
  '@': 'Mentioned you',
  '@T': 'Mentioned your team',
  AS: 'Assigned to you',
  AU: 'You wrote it',
  CM: 'You took part',
  FW: 'Following',
  ST: 'Pulled in as stack context',
};

/** The chip's words: "For you", "For team-devex", "Your PR"; empty for none. */
export function forWhomLabel(forWhom: ForWhom): string {
  switch (forWhom.kind) {
    case 'you':
      return 'For you';
    case 'team':
    case 'routing':
      return `For ${forWhom.team}`;
    case 'own':
      return 'Your PR';
    case 'none':
      return '';
  }
}

/**
 * The chip tooltip. A pulled-in PR also says which layer it is ("stack
 * layer below #12"); a found PR says it is not in the inbox.
 */
export function whyTitle(code: WhyCode, provenance?: Provenance): string {
  const label = WHY_LABELS[code];
  if (provenance?.kind === 'pulled_in') {
    return `${label}: ${provenance.reason}`;
  }
  if (provenance?.kind === 'found') {
    return `${label} (found: ${provenance.reason}; not in your inbox, found via GitHub)`;
  }
  return label;
}

const ROLE_LABELS: Record<TilePersonRole, string> = {
  author: 'author',
  assignee: 'assigned',
  you: 'you',
  reviewer: 'reviewer',
};

/** "rowan (author)" for the avatar stack tooltip. */
export function personTitle(login: string, role: TilePersonRole): string {
  return `${login} (${ROLE_LABELS[role]})`;
}

/** The whole turn as one line, for tooltips: "Your move: Review", "sol to merge". */
export function turnTitle(turn: WhoseTurn): string {
  if (turn.kind === 'you') {
    return `Your move: ${turn.what}`;
  }
  if (turn.kind === 'them' && turn.who === null) {
    return turn.what;
  }
  if (turn.kind === 'them' && turn.lead) {
    return [turn.lead, turn.who, turn.what].filter((part) => part).join(' ');
  }
  if (turn.kind === 'them') {
    return `Waiting on ${turn.who}: ${turn.who} ${turn.what}`;
  }
  return '';
}
