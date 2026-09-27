import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentOutputError, extractJson, parseAgentJson } from './json.ts';

describe('extractJson', () => {
  it('leaves bare JSON alone', () => {
    expect(extractJson(' {"a":1} ')).toBe('{"a":1}');
  });

  it('strips code fences', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('drops a sentence before and after the object', () => {
    expect(extractJson('Here you go:\n{"a":{"b":2}}\nHope that helps')).toBe('{"a":{"b":2}}');
  });
});

describe('parseAgentJson', () => {
  const schema = z.object({ a: z.number() });

  it('returns validated data', () => {
    expect(parseAgentJson('{"a":1}', schema)).toEqual({ a: 1 });
  });

  it('raises AgentOutputError with the raw text on bad JSON', () => {
    try {
      parseAgentJson('not json', schema);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AgentOutputError);
      expect((error as AgentOutputError).rawText).toBe('not json');
    }
  });

  it('raises AgentOutputError on the wrong shape', () => {
    expect(() => parseAgentJson('{"a":"one"}', schema)).toThrow(AgentOutputError);
  });
});
