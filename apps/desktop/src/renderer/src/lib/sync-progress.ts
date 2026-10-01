import type { SyncPhase, SyncProgress } from '@postpile/core';

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

/**
 * The title bar text while a sync runs: "syncing · agent 34/82 · 2m". The
 * total is what the sync planned so far and grows while it runs. Before
 * any call is planned it names the phase instead; before the engine
 * answers at all it is just "syncing…".
 */
export function syncProgressText(progress: SyncProgress | null | undefined, now: Date): string {
  if (!progress) {
    return 'syncing…';
  }
  const parts = ['syncing'];
  const firstPhase = progress.running[0];
  if (progress.agentCallsPlanned > 0) {
    parts.push(`agent ${progress.agentCallsDone}/${progress.agentCallsPlanned}`);
  } else if (firstPhase) {
    parts.push(PHASE_WORDS[firstPhase]);
  }
  parts.push(elapsedLabel(progress.startedAt, now));
  return parts.join(' · ');
}

/** Tooltip: what runs now and why the total can still grow. */
export function syncProgressDetail(progress: SyncProgress | null | undefined): string {
  if (!progress) {
    return 'Sync requested; waiting for the engine to start it.';
  }
  const running = progress.running.length > 0 ? progress.running.map((phase) => PHASE_WORDS[phase]).join(', ') : 'finishing up';
  return [
    `Started ${new Date(progress.startedAt).toLocaleTimeString()}`,
    `Running: ${running}`,
    `Agent calls: ${progress.agentCallsDone} done of ${progress.agentCallsPlanned} planned so far. The total grows as glances are planned once their topic's dossier is written.`,
  ].join('\n');
}
