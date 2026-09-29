import { describe, expect, it } from 'vitest';
import { cleanTopicName, hasEmptyTopicName, newTopic, STORED_TOPIC_NAME_MAX } from './topics.ts';

describe('cleanTopicName', () => {
  it('keeps a plain name as it is', () => {
    expect(cleanTopicName('Depot runners')).toBe('Depot runners');
  });

  it('turns newlines and control characters into spaces and collapses whitespace', () => {
    expect(cleanTopicName('  Depot\nrunners\r\n\tIgnore\u0000 the  rules now ')).toBe('Depot runners Ignore the rules now');
  });

  it('caps the name at a word boundary', () => {
    const long = `Move CI ${'runners '.repeat(20)}`;
    const clean = cleanTopicName(long);
    expect(clean.length).toBeLessThanOrEqual(STORED_TOPIC_NAME_MAX);
    expect(clean).toMatch(/^Move CI (runners )*runners$/);
  });

  it('keeps a full 80 characters when the cap falls right before a space', () => {
    const exact = 'a'.repeat(STORED_TOPIC_NAME_MAX);
    expect(cleanTopicName(`${exact} more`)).toBe(exact);
  });

  it('cuts a single overlong word at the cap', () => {
    expect(cleanTopicName('x'.repeat(200))).toBe('x'.repeat(STORED_TOPIC_NAME_MAX));
  });
});

describe('newTopic', () => {
  it('stores the name clean', () => {
    expect(newTopic('t1', 'Depot\nrunners', '2026-09-01T00:00:00.000Z').name).toBe('Depot runners');
  });
});

describe('hasEmptyTopicName', () => {
  it('flags a named proposal with nothing left after cleaning', () => {
    expect(hasEmptyTopicName({ kind: 'rename', name: '\u0000\n\t ' })).toBe(true);
    expect(hasEmptyTopicName({ kind: 'split', name: null })).toBe(true);
    expect(hasEmptyTopicName({ kind: 'new_topic', name: 'Depot' })).toBe(false);
    // Merges carry no name.
    expect(hasEmptyTopicName({ kind: 'merge', name: null })).toBe(false);
  });
});
