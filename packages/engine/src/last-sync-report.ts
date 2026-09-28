import type { SyncReport } from '@postpile/core';
import type { Store } from '@postpile/store';
import { phaseTimingsText } from './phase-clock.ts';

export const LAST_SYNC_REPORT_KEY = 'last_sync_report';

/** Kept so a failed start sync can still be read after the fact (footer, debug view). */
export function saveLastSyncReport(store: Store, report: SyncReport): void {
  store.meta.set(LAST_SYNC_REPORT_KEY, JSON.stringify(report));
}

export function loadLastSyncReport(store: Store): SyncReport | null {
  const raw = store.meta.get(LAST_SYNC_REPORT_KEY);
  return raw ? (JSON.parse(raw) as SyncReport) : null;
}

/** One log line per sync, errors on their own lines, for ~/Library/Logs/PostPile. */
export function syncReportLogLines(report: SyncReport): string[] {
  const seconds = ((new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime()) / 1000).toFixed(1);
  const summary =
    `sync: done in ${seconds}s, threads ${report.threads}, PRs fetched ${report.prsFetched}, found ${report.prsFound}, ` +
    `pulled in ${report.prsPulledIn}, new events ${report.newEvents}, agent calls ${report.agentCalls}, errors ${report.errors.length}`;
  const phases = phaseTimingsText(report.phaseMs ?? {});
  return [phases === '' ? summary : `${summary}; phases ${phases}`, ...report.errors.map((error) => `sync error: ${error}`)];
}
