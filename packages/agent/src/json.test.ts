import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AgentOutputError, extractJson, jsonCandidates, parseAgentJson } from './json.ts';

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

describe('jsonCandidates', () => {
  it('finds each top-level value and ignores brackets inside strings', () => {
    expect(jsonCandidates('first {"a":"}{"} then [1,[2]] done')).toEqual(['{"a":"}{"}', '[1,[2]]']);
  });

  it('handles escaped quotes inside strings', () => {
    expect(jsonCandidates('{"a":"say \\"hi\\" }"}')).toEqual(['{"a":"say \\"hi\\" }"}']);
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

  it('takes the corrected answer when the model answers twice', () => {
    // The shape of a real Sonnet answer (glance for acme/digest#30): a typo, a note, then the fix.
    const text = '{"a": 1, "note": "typo {"}\n\nWait, let me correct a typo in the verdict field.\n\n{"a": 2}';
    expect(parseAgentJson(text, schema)).toEqual({ a: 2 });
  });

  it('falls back to an earlier value when the last one has the wrong shape', () => {
    expect(parseAgentJson('{"a": 1}\nAlso: {"b": 2}', schema)).toEqual({ a: 1 });
  });

  it('reports the wrong shape when nothing fits', () => {
    expect(() => parseAgentJson('{"a":"one"} and {"a":"two"}', schema)).toThrow('wrong shape');
  });
});
