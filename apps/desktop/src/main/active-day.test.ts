import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActiveDayReporter, localDay } from './active-day.ts';

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'active-day-')), 'telemetry-active-day');
}

describe('ActiveDayReporter', () => {
  it('sends once per local day and remembers the day across restarts', () => {
    const file = tempFile();
    let sent = 0;
    const reporter = new ActiveDayReporter(file, () => (sent += 1));
    reporter.check(new Date(2026, 8, 29, 9, 0));
    reporter.check(new Date(2026, 8, 29, 18, 0));
    expect(sent).toBe(1);
    expect(readFileSync(file, 'utf8')).toBe('2026-09-29');

    const restarted = new ActiveDayReporter(file, () => (sent += 1));
    restarted.check(new Date(2026, 8, 29, 20, 0));
    expect(sent).toBe(1);
    restarted.check(new Date(2026, 8, 30, 0, 5));
    expect(sent).toBe(2);
  });

  it('formats the local day with padding', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});
