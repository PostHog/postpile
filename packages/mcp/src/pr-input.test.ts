import { describe, expect, it } from 'vitest';
import { parsePrInput } from './pr-input.ts';

describe('parsePrInput', () => {
  it('reads keys, URLs and bare numbers', () => {
    expect(parsePrInput('acme/app#1902')).toEqual({ kind: 'key', key: 'acme/app#1902' });
    expect(parsePrInput(' https://github.com/acme/app/pull/1902/files#diff-1 ')).toEqual({ kind: 'key', key: 'acme/app#1902' });
    expect(parsePrInput('#1902')).toEqual({ kind: 'number', number: 1902 });
    expect(parsePrInput('1902')).toEqual({ kind: 'number', number: 1902 });
  });

  it('refuses anything else', () => {
    expect(parsePrInput('the depot one')).toBeNull();
    expect(parsePrInput('#0')).toBeNull();
    expect(parsePrInput('acme#12')).toBeNull();
  });
});
