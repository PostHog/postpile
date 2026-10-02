import type { AppConfig, MacNotification } from '@postpile/core';
import type { EngineService } from '@postpile/engine';
import { ConsolidationSchedule } from './consolidation-schedule.ts';
import { pollSecondsFromEnv } from './engine-from-env.ts';

export interface BackgroundJobsOptions {
  onNotify?: (notifications: MacNotification[]) => void;
}

export interface BackgroundJobs {
  stop(): void;
}

export function startBackgroundJobs(engine: EngineService, config: AppConfig, options: BackgroundJobsOptions = {}): BackgroundJobs {
  engine.startLivePoll({
    intervalSeconds: pollSecondsFromEnv(process.env.POSTPILE_POLL_SECONDS),
    onNotify: options.onNotify ?? (() => {}),
  });
  // Agents on this Mac (Claude Code through postpile-mcp) leave requests in the
  // data folder: re-read a PR from GitHub, or suggest a topic change for the
  // Inbox. Only while the app runs; the MCP process says so when it does not.
  engine.startAgentRequests();
  // A background full sync every POSTPILE_AUTO_SYNC_MINUTES (default 60, 0 off),
  // counted from the end of the last sync and capped like "Sync now". The
  // engine skips it while a sync runs; the title bar shows it like any sync.
  engine.startAutoSync({ minutes: config.autoSyncMinutes, maxAgentCalls: config.syncCallCap });
  // "What you're working on": checked now and every 30 minutes, runs once a day from 06:00.
  engine.startWorkContextSchedule();
  // Consolidation (merge proposals, facts, retiring): checked every 30 minutes,
  // runs when due, capped like a sync. The engine never lets it overlap a sync.
  const consolidation = new ConsolidationSchedule((consolidateOptions) => engine.consolidate(consolidateOptions), config.syncCallCap);
  consolidation.start();
  return {
    stop() {
      engine.stopAgentRequests();
      engine.stopLivePoll();
      engine.stopAutoSync();
      engine.stopWorkContextSchedule();
      consolidation.stop();
    },
  };
}
