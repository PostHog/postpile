import type { z } from 'zod';

/** The model's answer did not match what the prompt asked for. Carries the raw text for logs. */
export class AgentOutputError extends Error {
  constructor(
    message: string,
    readonly rawText: string,
  ) {
    super(message);
    this.name = 'AgentOutputError';
  }
}

/**
 * Pulls the JSON value out of a model answer. Prompts ask for bare JSON, but
 * models still wrap it in ```json fences or add a sentence before it now and
 * then, so take the outermost {...} or [...] instead of failing on that.
 */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    return fenced[1];
  }
  const start = trimmed.search(/[[{]/);
  if (start === -1) {
    return trimmed;
  }
  const close = trimmed[start] === '{' ? '}' : ']';
  const end = trimmed.lastIndexOf(close);
  return end > start ? trimmed.slice(start, end + 1) : trimmed;
}

/**
 * Every complete top-level {...} or [...] in the text, in order. Brackets
 * inside JSON strings do not count. Prose around and between them is skipped.
 */
export function jsonCandidates(text: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"' && depth > 0) {
      inString = true;
    } else if (char === '{' || char === '[') {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if ((char === '}' || char === ']') && depth > 0) {
      depth -= 1;
      if (depth === 0) {
        found.push(text.slice(start, i + 1));
      }
    }
  }
  return found;
}

/**
 * Parses and validates a model answer. Sonnet sometimes answers, spots a
 * typo, writes "Wait, let me correct a typo" and answers again, so the text
 * holds two JSON objects. The last one that parses and fits the schema wins;
 * the outermost-brackets reading is the fallback for anything else.
 */
export function parseAgentJson<T>(text: string, schema: z.ZodType<T>): T {
  const readings = [...jsonCandidates(text).reverse(), extractJson(text)];
  let shapeError: string | null = null;
  for (const reading of readings) {
    let value: unknown;
    try {
      value = JSON.parse(reading);
    } catch {
      continue;
    }
    const result = schema.safeParse(value);
    if (result.success) {
      return result.data;
    }
    shapeError ??= result.error.message;
  }
  if (shapeError !== null) {
    throw new AgentOutputError(`agent answer has the wrong shape: ${shapeError}`, text);
  }
  throw new AgentOutputError('agent answer is not valid JSON', text);
}
