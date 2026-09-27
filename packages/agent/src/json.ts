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

export function parseAgentJson<T>(text: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(extractJson(text));
  } catch {
    throw new AgentOutputError('agent answer is not valid JSON', text);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AgentOutputError(`agent answer has the wrong shape: ${result.error.message}`, text);
  }
  return result.data;
}
