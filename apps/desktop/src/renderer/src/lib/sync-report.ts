import type { SyncReport } from '@postpile/core';
import { callStatsDetail, skippedByCap } from './agent-stats.ts';

/** "12.3s" or "2m 05s". */
export function durationLabel(report: SyncReport): string {
  const ms = Math.max(new Date(report.finishedAt).getTime() - new Date(report.startedAt).getTime(), 0);
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
}

/**
 * The whole report as plain lines, for the footer and title bar tooltips and
 * the debug view: timing, what was fetched, agent calls per kind, what the
 * cap left over, and every error.
 */
export function syncReportDetail(report: SyncReport): string {
  const lines = [
    `Started ${new Date(report.startedAt).toLocaleString()}, took ${durationLabel(report)}`,
    `Threads ${report.threads}${report.notificationsNotModified ? ' (inbox unchanged)' : ''} · PRs fetched ${report.prsFetched} · found ${report.prsFound} · pulled in ${report.prsPulledIn} · waiting ${report.prsSkipped}`,
    `New events ${report.newEvents} · dossiers updated ${report.dossiersUpdated}`,
  ];
  const calls = callStatsDetail(report.agentCallStats);
  lines.push(calls === '' ? 'No agent calls' : `Agent calls ${report.agentCallStats.total}:\n${calls}`);
  const capped = skippedByCap(report.agentCallStats);
  if (capped > 0) {
    lines.push(`Skipped by the call cap: ${capped}`);
  }
  if (report.errors.length > 0) {
    lines.push(`Errors (${report.errors.length}):`, ...report.errors.map((error) => `- ${error}`));
  }
  return lines.join('\n');
}
