// The sidebar row's faces split for the team pill (2026-09-29): you and
// your teammates together inside one sea pill, the other authors after it.
import type { TopicPerson } from '@postpile/core';

export interface TeamPill {
  /** You first, then teammates, as core ordered them. Empty: no pill. */
  ours: TopicPerson[];
  /** The other authors, outside the pill. */
  others: TopicPerson[];
  /** "You and your team: you, lyra"; empty when there is no pill. */
  title: string;
}

export function teamPill(faces: TopicPerson[]): TeamPill {
  const ours = faces.filter((person) => person.relation !== 'other');
  const others = faces.filter((person) => person.relation === 'other');
  const logins = ours.map((person) => (person.relation === 'you' ? `${person.login} (you)` : person.login));
  return { ours, others, title: ours.length > 0 ? `You and your team: ${logins.join(', ')}` : '' };
}
