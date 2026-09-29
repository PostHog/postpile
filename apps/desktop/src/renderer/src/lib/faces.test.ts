import { describe, expect, it } from 'vitest';
import type { TopicPerson } from '@postpile/core';
import { teamPill } from './faces.ts';

const person = (login: string, relation: TopicPerson['relation']): TopicPerson => ({ login, relation });

describe('teamPill', () => {
  it('puts you and your teammates in the pill, the others after it', () => {
    const pill = teamPill([person('alice', 'you'), person('lyra', 'team'), person('ada', 'other')]);
    expect(pill.ours.map((face) => face.login)).toEqual(['alice', 'lyra']);
    expect(pill.others.map((face) => face.login)).toEqual(['ada']);
    expect(pill.title).toBe('You and your team: alice (you), lyra');
  });

  it('holds just you when nobody else from your team authored', () => {
    const pill = teamPill([person('alice', 'you'), person('ada', 'other')]);
    expect(pill.ours).toEqual([person('alice', 'you')]);
    expect(pill.title).toBe('You and your team: alice (you)');
  });

  it('has no pill when nobody from your team authored', () => {
    const pill = teamPill([person('ada', 'other'), person('bob', 'other')]);
    expect(pill.ours).toEqual([]);
    expect(pill.others).toHaveLength(2);
    expect(pill.title).toBe('');
  });
});
