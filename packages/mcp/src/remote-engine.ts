import type {
  AgentRefreshOptions,
  AgentRefreshResult,
  AgentRefreshTarget,
  ListScope,
  PrDetail,
  PrKey,
  PrNoteRequest,
  PrNoteResult,
  PrNotesView,
  PrOverlapsView,
  RecordedSyncProgress,
  SearchResult,
  SyncReport,
  TeamMembersView,
  TopicChangeRequest,
  TopicChangeResult,
  TopicDetail,
  TopicListItem,
  ViewerView,
} from '@postpile/core';
import type { EngineService } from '@postpile/engine';
import { TOKEN_HEADER, type SharedEngineMethod } from '@postpile/server';
import type { PostPileReader } from './reads.ts';

/** What an MCP server needs from an engine: the reads, plus the asks InMemoryAgentRequests passes on. */
export type SharedEngine = PostPileReader & Pick<EngineService, 'refreshNow' | 'proposeTopicChange' | 'notePr'>;

/**
 * The engine of a running fake server (POSTPILE_FAKE=1 pnpm server), reached
 * over its token-protected /api/fake/engine route. `pnpm cli mcp --api <url>`
 * serves MCP on top of it, so MCP clients and the UI share one sample. Calls
 * are never retried: a lost answer to notePr or proposeTopicChange must not
 * file twice.
 */
export class RemoteEngine implements SharedEngine {
  constructor(
    private readonly apiUrl: string,
    private readonly token: string,
  ) {}

  private async call<T>(method: SharedEngineMethod, args: unknown[]): Promise<T> {
    // JSON turns a trailing undefined into null, which an optional parameter does not take.
    const sent = [...args];
    while (sent.length > 0 && sent[sent.length - 1] === undefined) {
      sent.pop();
    }
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/api/fake/engine/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [TOKEN_HEADER]: this.token },
        body: JSON.stringify({ args: sent }),
      });
    } catch {
      throw new Error(`the fake server at ${this.apiUrl} is not reachable; start it with POSTPILE_FAKE=1 pnpm server`);
    }
    // A real server has no such route: Hono answers 404 in plain text.
    if (response.status === 404) {
      throw new Error(`${this.apiUrl} has no shared engine; only a server started with POSTPILE_FAKE=1 has one`);
    }
    const body = (await response.json()) as { result?: T; error?: string };
    if (!response.ok) {
      throw new Error(body.error ?? `the fake server answered ${response.status}`);
    }
    return body.result as T;
  }

  getPr(key: PrKey): Promise<PrDetail | null> {
    return this.call('getPr', [key]);
  }

  getTopic(topicId: string): Promise<TopicDetail | null> {
    return this.call('getTopic', [topicId]);
  }

  listTopics(scope?: ListScope): Promise<TopicListItem[]> {
    return this.call('listTopics', [scope]);
  }

  search(query: string, scope?: ListScope): Promise<SearchResult> {
    return this.call('search', [query, scope]);
  }

  getViewer(): Promise<ViewerView> {
    return this.call('getViewer', []);
  }

  getTeamMembers(): Promise<TeamMembersView> {
    return this.call('getTeamMembers', []);
  }

  prOverlaps(): Promise<PrOverlapsView> {
    return this.call('prOverlaps', []);
  }

  lastSyncReport(): Promise<SyncReport | null> {
    return this.call('lastSyncReport', []);
  }

  recordedSyncProgress(): Promise<RecordedSyncProgress | null> {
    return this.call('recordedSyncProgress', []);
  }

  recordedAppVersion(): Promise<string | null> {
    return this.call('recordedAppVersion', []);
  }

  listPrNotes(prKeys: PrKey[]): Promise<PrNotesView[]> {
    return this.call('listPrNotes', [prKeys]);
  }

  refreshNow(target: AgentRefreshTarget, options: AgentRefreshOptions): Promise<AgentRefreshResult> {
    return this.call('refreshNow', [target, options]);
  }

  proposeTopicChange(change: TopicChangeRequest, options: { client: string }): Promise<TopicChangeResult> {
    return this.call('proposeTopicChange', [change, options]);
  }

  notePr(request: PrNoteRequest, options: { client: string }): Promise<PrNoteResult> {
    return this.call('notePr', [request, options]);
  }
}
