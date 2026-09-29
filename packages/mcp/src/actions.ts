// The two tools that ask the running app to do something: re-read PRs from
// GitHub (refresh_from_github) and file a topic suggestion for the user
// (propose_topic_change). The MCP process itself still never writes the
// database or GitHub; see agent-requests.ts.
import { AGENT_REQUEST_WAIT_MS, type AgentRefreshResult, type AgentRefreshTarget, type AgentRequestResult, type PrKey, type TopicChangeKind, type TopicChangeResult } from '@postpile/core';
import type { AgentAsk, AgentRequests } from './agent-requests.ts';
import { notTracked, resolvePr, resolveTopic, toolError, type ReadContext, type ToolAnswer } from './reads.ts';
import { ago, answer, minute } from './text.ts';

export interface ActionContext extends ReadContext {
  requests: AgentRequests;
  /** The MCP client's name from its initialize handshake, e.g. "claude-code". */
  client: () => string;
}

const WAIT_SECONDS = AGENT_REQUEST_WAIT_MS / 1000;

/** "PostPile is not running": the same words for both tools, with the age of the stored data. */
async function notRunning(ctx: ActionContext): Promise<ToolAnswer> {
  const report = await ctx.reader.lastSyncReport();
  const asOf = report ? `Data is as of ${minute(report.finishedAt)}.` : 'It has no data yet.';
  return toolError([`PostPile is not running, nothing was done. ${asOf} Continue with the stored data or ask the user to open PostPile.`]);
}

type OkResult = Extract<AgentRequestResult, { ok: true }>;

/**
 * What came of asking the app, as both tools handle it: a finished answer
 * (not running, not picked up, refused), still running (taken but no
 * answer within the wait), or the app's result.
 */
type Asked = { kind: 'answer'; answer: ToolAnswer } | { kind: 'running' } | { kind: 'result'; result: OkResult };

async function ask(ctx: ActionContext, request: AgentAsk): Promise<Asked> {
  const outcome = await ctx.requests.ask(request, ctx.client());
  if (outcome.kind === 'not_running') {
    return { kind: 'answer', answer: await notRunning(ctx) };
  }
  if (outcome.kind === 'timeout') {
    if (outcome.taken) {
      return { kind: 'running' };
    }
    return { kind: 'answer', answer: toolError([`PostPile did not pick up the request within ${WAIT_SECONDS} s, so nothing was done. The app may be busy; continue with the stored data.`]) };
  }
  if (!outcome.result.ok) {
    return { kind: 'answer', answer: toolError([`PostPile refused the request: ${outcome.result.error}. Nothing was done.`]) };
  }
  return { kind: 'result', result: outcome.result };
}

// ---------------------------------------------------------------------------
// refresh_from_github
// ---------------------------------------------------------------------------

export interface RefreshArgs {
  pr?: string;
  topic?: string;
}

const REFRESH_EXAMPLES = 'Examples: refresh_from_github(pr: "acme/app#1902") or refresh_from_github(topic: "depot")';

async function refreshTarget(ctx: ActionContext, args: RefreshArgs): Promise<AgentRefreshTarget | ToolAnswer> {
  const pr = args.pr?.trim() ?? '';
  const topic = args.topic?.trim() ?? '';
  if ((pr === '') === (topic === '')) {
    return toolError([`Pass exactly one of pr or topic. ${REFRESH_EXAMPLES}`]);
  }
  if (pr !== '') {
    const resolved = await resolvePr(ctx.reader, pr);
    if (!resolved.ok) {
      return resolved.error;
    }
    return (await ctx.reader.getPr(resolved.key)) ? { kind: 'pr', prKey: resolved.key } : notTracked(resolved.key);
  }
  const match = await resolveTopic(ctx.reader, topic);
  return match.ok ? { kind: 'topic', topicId: match.item.topic.id } : match.error;
}

function keys(list: PrKey[]): string {
  return list.length > 0 ? ` (${list.join(', ')})` : '';
}

function refreshText(result: AgentRefreshResult, now: Date): string[] {
  if (result.prKeys.length === 0) {
    return ['The topic has no open PRs, so there was nothing to re-read.'];
  }
  const lines: string[] = [];
  if (result.joinedSync) {
    lines.push('A full sync was running; PostPile waited for it instead of reading on its own.');
  }
  const unchanged = result.fetched.filter((key) => !result.changed.includes(key));
  lines.push(`Re-read from GitHub: ${result.fetched.length} of ${result.prKeys.length} PRs${keys(result.fetched)}.`);
  if (result.changed.length > 0) {
    lines.push(`New activity on ${result.changed.length}${keys(result.changed)}.`);
  }
  if (unchanged.length > 0) {
    lines.push(`No new activity on ${unchanged.length}${keys(unchanged)}.`);
  }
  for (const entry of result.fresh) {
    lines.push(`Skipped as fresh: ${entry.prKey}, fetched ${ago(entry.fetchedAt, now)}.`);
  }
  lines.push('pr_context shows the new state now. The glance and dossier may update in the background; refreshing again will not speed that up.');
  return lines;
}

function refreshStructured(result: AgentRefreshResult): Record<string, unknown> {
  return {
    status: result.fetched.length === 0 && !result.joinedSync ? 'all_fresh' : 'refreshed',
    prs: result.prKeys.length,
    fetched: result.fetched.length,
    changed: result.changed.length,
    skipped_fresh: result.fresh.length,
  };
}

export async function refreshFromGithub(ctx: ActionContext, args: RefreshArgs): Promise<ToolAnswer> {
  const target = await refreshTarget(ctx, args);
  if (!('kind' in target)) {
    return target;
  }
  const asked = await ask(ctx, { kind: 'refresh', payload: target });
  if (asked.kind === 'answer') {
    return asked.answer;
  }
  if (asked.kind === 'running') {
    return {
      text: `PostPile is still reading GitHub after ${WAIT_SECONDS} s. Read pr_context again in a minute.`,
      found: true,
      structured: { status: 'running', prs: 0, fetched: 0, changed: 0, skipped_fresh: 0 },
    };
  }
  const { result } = asked;
  if (result.kind !== 'refresh') {
    return toolError(['PostPile answered a different request. Nothing is known about this refresh; try again.']);
  }
  const refresh = result.refresh;
  if (refresh.status === 'blocked') {
    const retry = refresh.retryAt ? ` Try again after ${minute(refresh.retryAt)}.` : '';
    return toolError([`Nothing was read from GitHub: ${refresh.reason ?? 'refused'}${retry} Go on with the stored data.`]);
  }
  return { text: refreshText(refresh, ctx.now()).join('\n'), found: true, structured: refreshStructured(refresh) };
}

// ---------------------------------------------------------------------------
// propose_topic_change
// ---------------------------------------------------------------------------

export interface ProposeArgs {
  topic: string;
  kind: TopicChangeKind;
  prs?: string[];
  name?: string;
  into_topic?: string;
  reason: string;
  dry_run: boolean;
}

const PROPOSE_EXAMPLES: Record<TopicChangeKind, string> = {
  split: 'propose_topic_change(topic: "depot", kind: "split", prs: ["acme/app#1902"], name: "Turbo cache", reason: "...")',
  rename: 'propose_topic_change(topic: "depot", kind: "rename", name: "Depot runners", reason: "...")',
  merge: 'propose_topic_change(topic: "frontend build", kind: "merge", into_topic: "depot", reason: "...")',
};

async function resolvePrs(ctx: ActionContext, inputs: string[]): Promise<PrKey[] | ToolAnswer> {
  const result: PrKey[] = [];
  for (const input of inputs) {
    const resolved = await resolvePr(ctx.reader, input, 'prs');
    if (!resolved.ok) {
      return resolved.error;
    }
    if (!result.includes(resolved.key)) {
      result.push(resolved.key);
    }
  }
  return result;
}

function proposeStructured(result: TopicChangeResult): Record<string, unknown> {
  return { status: result.status, proposal_id: result.proposalId, prs_moved: result.movedPrKeys.length };
}

export async function proposeTopicChange(ctx: ActionContext, args: ProposeArgs): Promise<ToolAnswer> {
  const example = `Example: ${PROPOSE_EXAMPLES[args.kind]}`;
  const name = args.name?.trim() ?? '';
  if ((args.kind === 'split' || args.kind === 'rename') && name === '') {
    return toolError([`${args.kind} needs name: the ${args.kind === 'split' ? "new topic's name" : 'new name'}. ${example}`]);
  }
  if (args.kind === 'split' && (args.prs ?? []).length === 0) {
    return toolError([`split needs prs: the PRs to move into the new topic. ${example}`]);
  }
  if (args.kind === 'merge' && !args.into_topic?.trim()) {
    return toolError([`merge needs into_topic: the topic to merge into. ${example}`]);
  }
  const topic = await resolveTopic(ctx.reader, args.topic);
  if (!topic.ok) {
    return topic.error;
  }
  let intoTopicId: string | null = null;
  if (args.kind === 'merge') {
    const into = await resolveTopic(ctx.reader, args.into_topic ?? '', 'into_topic');
    if (!into.ok) {
      return into.error;
    }
    intoTopicId = into.item.topic.id;
  }
  const prKeys = args.kind === 'split' ? await resolvePrs(ctx, args.prs ?? []) : [];
  if (!Array.isArray(prKeys)) {
    return prKeys;
  }
  const payload = {
    topicId: topic.item.topic.id,
    kind: args.kind,
    prKeys,
    name: args.kind === 'merge' ? null : name,
    intoTopicId,
    reason: args.reason.trim(),
    dryRun: args.dry_run,
  };
  const asked = await ask(ctx, { kind: 'propose_topic_change', payload });
  if (asked.kind === 'answer') {
    return asked.answer;
  }
  if (asked.kind === 'running') {
    return toolError([`PostPile took the suggestion but did not answer within ${WAIT_SECONDS} s. It may still file it: check topic(topic: "${payload.topicId}") in a minute before suggesting it again.`]);
  }
  const { result } = asked;
  if (result.kind !== 'propose_topic_change') {
    return toolError(['PostPile answered a different request. Nothing is known about this suggestion; check topic() before trying again.']);
  }
  const change = result.topicChange;
  if (change.status === 'refused') {
    return toolError([`Not filed: ${change.reason ?? 'refused'}`]);
  }
  const head =
    change.status === 'filed'
      ? `Filed as a suggestion for the user (id ${change.proposalId}). Nothing changes until they accept it in PostPile's Inbox.`
      : 'Dry run: nothing was filed.';
  const footer =
    change.status === 'filed'
      ? [`topic(topic: "${payload.topicId}") shows whether the user accepted or rejected it. Unanswered suggestions expire after 14 days.`]
      : ['Call again without dry_run to file it.'];
  return { text: answer([head, 'What accepting would do:'], change.preview, footer), found: true, structured: proposeStructured(change) };
}
