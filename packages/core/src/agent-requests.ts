import type { IsoTime, PrKey } from './types.ts';

// What outside agents may ask the running app to do through the MCP server
// (DESIGN.md "Agent requests"): re-read PRs from GitHub now
// (refresh_from_github), or file a topic change for the user to decide
// (propose_topic_change). The app does the work: only it holds the GitHub
// client, the quota readings and the database's write lock.

/** A PR fetched this recently is skipped as fresh. */
export const AGENT_REFRESH_FRESH_MS = 60_000;
/** Agent refreshes that read GitHub, per rolling hour, across every MCP client. */
export const AGENT_REFRESHES_PER_HOUR = 20;
/** A topic refresh reads at most this many of its open PRs. */
export const AGENT_REFRESH_TOPIC_MAX_PRS = 10;

/** Who asked for a refresh: an outside agent, by its MCP client name ("claude-code"). */
export interface AgentRefreshOptions {
  source: 'agent';
  client: string;
}

/** One PR, or one topic's open PRs (unread and your move first, then newest). */
export type AgentRefreshTarget = { kind: 'pr'; prKey: PrKey } | { kind: 'topic'; topicId: string };

export interface AgentRefreshResult {
  /** done: the app read GitHub (or found every PR fresh); blocked: nothing was read, see reason and retryAt. */
  status: 'done' | 'blocked';
  /** The PRs the refresh was about. */
  prKeys: PrKey[];
  /** PRs whose snapshot was written by this refresh. */
  fetched: PrKey[];
  /** Fetched PRs that came back with new events. */
  changed: PrKey[];
  /** PRs skipped because they were fetched less than AGENT_REFRESH_FRESH_MS ago. */
  fresh: { prKey: PrKey; fetchedAt: IsoTime }[];
  /** A full sync was running; the refresh waited for it instead of reading GitHub itself. */
  joinedSync: boolean;
  /** blocked: why, for the agent. */
  reason: string | null;
  /** blocked: when trying again makes sense; null when it does not help (e.g. unknown PR). */
  retryAt: IsoTime | null;
}
