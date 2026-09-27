import type { PrKey, PrRef } from './types.ts';

export function prKey(ref: PrRef): PrKey {
  return `${ref.repo}#${ref.number}`;
}

export function parsePrKey(key: PrKey): PrRef {
  const hash = key.lastIndexOf('#');
  const repo = key.slice(0, hash);
  const number = Number(key.slice(hash + 1));
  if (hash <= 0 || !repo.includes('/') || !Number.isInteger(number) || number <= 0) {
    throw new Error(`invalid PR key: ${key}`);
  }
  return { repo, number };
}
