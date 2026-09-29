import type { PrKey } from '@postpile/core';

/** What a caller passed as `pr`: a full key, or only a number to look up in the store. */
export type PrInput = { kind: 'key'; key: PrKey } | { kind: 'number'; number: number };

const URL_PATTERN = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;
const KEY_PATTERN = /^([\w.-]+\/[\w.-]+)#(\d+)$/;
const NUMBER_PATTERN = /^#?(\d+)$/;

/**
 * Accepts what an agent is likely to have at hand: "acme/app#1902", a PR URL
 * (also with /files or a #fragment behind it), "#1902" or "1902". Null for
 * anything else.
 */
export function parsePrInput(input: string): PrInput | null {
  const text = input.trim();
  const url = URL_PATTERN.exec(text);
  if (url) {
    return { kind: 'key', key: `${url[1]}#${Number(url[2])}` };
  }
  const key = KEY_PATTERN.exec(text);
  if (key) {
    return { kind: 'key', key: `${key[1]}#${Number(key[2])}` };
  }
  const number = NUMBER_PATTERN.exec(text);
  if (number && Number(number[1]) > 0) {
    return { kind: 'number', number: Number(number[1]) };
  }
  return null;
}
