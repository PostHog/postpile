import type { SyncPhase, SyncProgress } from '@postpile/core';
import { callStatsDetail } from './agent-stats.ts';

/** "45s", "2m", "1h 05m": how long the sync has been running. */
export function elapsedLabel(startedAt: string, now: Date): string {
  const seconds = Math.max(Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000), 0);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

const PHASE_WORDS: Record<SyncPhase, string> = {
  fetch: 'fetching GitHub',
  tidy: 'tidying topics',
  topics: 'sorting topics',
  dossiers: 'dossiers',
  facts: 'facts',
  sets: 'sets',
  glances: 'glances',
  events: 'events',
};

/** "nothing new on GitHub" or "8 new on GitHub"; null while the fetch runs. */
function gitHubNewsWords(progress: SyncProgress): string | null {
  if (!progress.fromGitHub) {
    return null;
  }
  const events = progress.fromGitHub.newEvents;
  return events === 0 ? 'nothing new on GitHub' : `${events} new on GitHub`;
}

/**
 * The title bar text while a sync runs: "syncing · nothing new on GitHub ·
 * agent calls 12/19 · 2m". What GitHub brought comes first, so agent work
 * after "nothing new" reads as digesting what the poll already stored, not
 * as the app having fallen behind. The total is what the sync planned so
 * far and grows while it runs. Before any call is planned it names the
 * phase instead; before the engine answers at all it is just "syncing…".
 */
export function syncProgressText(progress: SyncProgress | null | undefined, now: Date): string {
  if (!progress) {
    return 'syncing…';
  }
  const parts = ['syncing'];
  const news = gitHubNewsWords(progress);
  if (news) {
    parts.push(news);
  }
  const firstPhase = progress.running[0];
  if (progress.agentCallsPlanned > 0) {
    parts.push(`agent calls ${progress.agentCallsDone}/${progress.agentCallsPlanned}`);
  } else if (firstPhase) {
    parts.push(PHASE_WORDS[firstPhase]);
  }
  parts.push(elapsedLabel(progress.startedAt, now));
  return parts.join(' · ');
}

/** The tooltip's GitHub line: what the fetch brought, and what the agent works on without news. */
function gitHubLine(progress: SyncProgress): string {
  if (!progress.fromGitHub) {
    return 'GitHub: fetching';
  }
  const { prsFetched, newEvents } = progress.fromGitHub;
  if (newEvents === 0) {
    return 'GitHub: nothing new. The agent works on what the live poll already stored: topics with news it left for the full sync, sets and stacks.';
  }
  return `GitHub: ${newEvents} new ${newEvents === 1 ? 'event' : 'events'} on ${prsFetched} ${prsFetched === 1 ? 'PR' : 'PRs'}.`;
}

/** Tooltip: what GitHub brought, what runs now, what the calls went to, and why the total can still grow. */
export function syncProgressDetail(progress: SyncProgress | null | undefined): string {
  if (!progress) {
    return 'Sync requested; waiting for the engine to start it.';
  }
  const running = progress.running.length > 0 ? progress.running.map((phase) => PHASE_WORDS[phase]).join(', ') : 'finishing up';
  const lines = [
    `Started ${new Date(progress.startedAt).toLocaleTimeString()}`,
    gitHubLine(progress),
    `Running: ${running}`,
    `Agent calls: ${progress.agentCallsDone} done of ${progress.agentCallsPlanned} planned so far. The total grows as glances are planned once their topic's dossier is written.`,
  ];
  const byKind = callStatsDetail(progress.agentCallStats);
  if (byKind !== '') {
    lines.push(byKind);
  }
  return lines.join('\n');
}
