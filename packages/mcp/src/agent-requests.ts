// The MCP side of the agent-request outbox (DESIGN.md "Agent requests"): the
// MCP process never writes the database or GitHub; it leaves a request file
// for the running app and waits for the answer.
import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_REQUEST_TTL_MS,
  AGENT_REQUEST_VERSION,
  AGENT_REQUEST_WAIT_MS,
  type AgentRefreshTarget,
  type AgentRequest,
  type AgentRequestResult,
  type PrNoteRequest,
  type TopicChangeRequest,
} from '@postpile/core';
import { answerAgentRequest, type EngineService } from '@postpile/engine';

export type AgentAsk =
  | { kind: 'refresh'; payload: AgentRefreshTarget }
  | { kind: 'propose_topic_change'; payload: TopicChangeRequest }
  | { kind: 'note_pr'; payload: PrNoteRequest };

/**
 * What came of a request:
 * - answered: the app's result
 * - not_running: the app does not run, nothing was written or queued
 * - timeout: no answer within the wait; `taken` says whether the app had
 *   picked it up (it may still finish) or not (the request was withdrawn)
 */
export type AgentAskOutcome = { kind: 'answered'; result: AgentRequestResult } | { kind: 'not_running' } | { kind: 'timeout'; taken: boolean };

export interface AgentRequests {
  ask(ask: AgentAsk, client: string): Promise<AgentAskOutcome>;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function envelope(ask: AgentAsk, client: string, now: Date): AgentRequest {
  const base = {
    v: AGENT_REQUEST_VERSION,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AGENT_REQUEST_TTL_MS).toISOString(),
    client,
  } as const;
  if (ask.kind === 'refresh') {
    return { ...base, kind: 'refresh', payload: ask.payload };
  }
  if (ask.kind === 'note_pr') {
    return { ...base, kind: 'note_pr', payload: ask.payload };
  }
  return { ...base, kind: 'propose_topic_change', payload: ask.payload };
}

export interface FileAgentRequestsOptions {
  /** `<data folder>/agent-requests`. */
  folder: string;
  /** Whether the desktop app holds the data folder right now; asked fresh before every request. */
  appRunning: () => boolean;
  now?: () => Date;
  /** Defaults to AGENT_REQUEST_WAIT_MS. */
  waitMs?: number;
  /** How often to look for the answer. */
  pollMs?: number;
}

/** Requests as files next to the database, answered by the running app's AgentRequestInbox. */
export class FileAgentRequests implements AgentRequests {
  constructor(private readonly options: FileAgentRequestsOptions) {}

  /** Temp file, then rename: the app never sees half a request. */
  private write(id: string, request: AgentRequest): void {
    const { folder } = this.options;
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const temp = join(folder, `.${id}.tmp`);
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeSync(fd, JSON.stringify(request));
    } finally {
      closeSync(fd);
    }
    renameSync(temp, join(folder, `${id}.json`));
  }

  /** The answer, removed once read; null while there is none. */
  private collect(id: string): AgentRequestResult | null {
    const path = join(this.options.folder, `${id}.result.json`);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
    rmSync(path, { force: true });
    const result = JSON.parse(text) as AgentRequestResult;
    if (result.v !== AGENT_REQUEST_VERSION || typeof result.ok !== 'boolean') {
      return { v: AGENT_REQUEST_VERSION, ok: false, error: 'PostPile answered in a format this MCP server does not know; update PostPile.' };
    }
    return result;
  }

  /** Takes the request back if the app has not claimed it; false when the app has it. */
  private withdraw(id: string): boolean {
    try {
      rmSync(join(this.options.folder, `${id}.json`));
      return true;
    } catch (error) {
      if (isMissing(error)) {
        return false;
      }
      throw error;
    }
  }

  async ask(ask: AgentAsk, client: string): Promise<AgentAskOutcome> {
    // Nothing is queued for an app that does not run: the intent would go stale.
    if (!this.options.appRunning()) {
      return { kind: 'not_running' };
    }
    const now = this.options.now ?? (() => new Date());
    const id = randomUUID();
    this.write(id, envelope(ask, client, now()));
    const waitMs = this.options.waitMs ?? AGENT_REQUEST_WAIT_MS;
    const pollMs = this.options.pollMs ?? 100;
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      const result = this.collect(id);
      if (result) {
        return { kind: 'answered', result };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    const result = this.collect(id);
    if (result) {
      return { kind: 'answered', result };
    }
    return { kind: 'timeout', taken: !this.withdraw(id) };
  }
}

/**
 * Sample data (POSTPILE_FAKE=1): no app to ask. The fake engine answers in
 * memory, through the same answerAgentRequest the app's inbox uses, so
 * `pnpm cli mcp` over sample data can try both tools.
 */
export class InMemoryAgentRequests implements AgentRequests {
  constructor(
    private readonly engine: Pick<EngineService, 'refreshNow' | 'proposeTopicChange' | 'notePr'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ask(ask: AgentAsk, client: string): Promise<AgentAskOutcome> {
    return { kind: 'answered', result: await answerAgentRequest(this.engine, envelope(ask, client, this.now())) };
  }
}
