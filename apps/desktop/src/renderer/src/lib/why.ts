import type { Provenance, TilePersonRole, WhoseTurn, WhyCode } from '@postpile/core';

/**
 * you: aimed at the viewer (honey). team: at one of their teams (sea).
 * own: their own PR (neutral). passive: took part or follows (quiet grey).
 * context: pulled in for the stack (dashed outline).
 */
export type WhyTone = 'you' | 'team' | 'own' | 'passive' | 'context';

export const WHY: Record<WhyCode, { label: string; tone: WhyTone }> = {
  RV: { label: 'Review asked of you', tone: 'you' },
  RT: { label: 'Review asked of your team', tone: 'team' },
  '@': { label: 'Mentioned you', tone: 'you' },
  '@T': { label: 'Mentioned your team', tone: 'team' },
  AS: { label: 'Assigned to you', tone: 'you' },
  AU: { label: 'You wrote it', tone: 'own' },
  CM: { label: 'You took part', tone: 'passive' },
  FW: { label: 'Following', tone: 'passive' },
  ST: { label: 'Pulled in as stack context', tone: 'context' },
};

/** The badge tooltip. A pulled-in PR also says which layer it is ("stack layer below #12"). */
export function whyTitle(code: WhyCode, provenance?: Provenance): string {
  const label = WHY[code].label;
  if (provenance?.kind === 'pulled_in') {
    return `${label}: ${provenance.reason}`;
  }
  return label;
}

const ROLE_LABELS: Record<TilePersonRole, string> = {
  author: 'author',
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
  if (turn.kind === 'them') {
    return `Waiting on ${turn.who}: ${turn.who} ${turn.what}`;
  }
  return '';
}
