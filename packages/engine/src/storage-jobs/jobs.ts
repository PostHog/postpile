import { BotBodyTrimJob } from './bot-body-trim.ts';
import { ChecksStripJob } from './checks-strip.ts';
import type { StorageJob } from './runner.ts';

/**
 * Every storage job, in the order they run. A job starts only once every
 * job before it is done, so an install that skipped releases runs them all,
 * in turn. Append only: never reorder them, rename one or reuse a meta key.
 */
export function storageJobs(): StorageJob[] {
  return [new BotBodyTrimJob(), new ChecksStripJob()];
}
