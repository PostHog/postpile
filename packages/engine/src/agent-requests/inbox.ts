import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeSync, type FSWatcher, type Stats } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_REQUEST_FILE,
  AGENT_REQUEST_MAX_BYTES,
  AGENT_REQUEST_VERSION,
  AGENT_RESULT_MAX_AGE_MS,
  parseAgentRequest,
  type AgentRequest,
  type AgentRequestResult,
} from '@postpile/core';
import { errorText } from '../errors.ts';

/** fs.watch can miss events (a busy folder, some file systems): the folder is scanned this often too. */
const RESCAN_MS = 5000;

export interface AgentRequestInboxOptions {
  /** `<data folder>/agent-requests`. */
  folder: string;
  handle: (request: AgentRequest) => Promise<AgentRequestResult>;
  now?: () => Date;
  log?: (line: string) => void;
  /** 0 turns the rescan timer off (tests call scan()). */
  rescanMs?: number;
  /** Whether to watch the folder for new files; tests scan by hand. Default true. */
  watch?: boolean;
}

function errorResult(error: string): AgentRequestResult {
  return { v: AGENT_REQUEST_VERSION, ok: false, error };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

/** The owner check; on systems without uids (Windows) it passes. */
function ownedByUs(stats: Stats): boolean {
  return typeof process.getuid !== 'function' || stats.uid === process.getuid();
}

/**
 * The app side of the agent-request outbox (DESIGN.md "Agent requests"):
 * watches `<data folder>/agent-requests`, takes each `<uuid>.json`, checks
 * it and answers with `<uuid>.result.json`. The MCP process writes the
 * requests and waits for the answer.
 *
 * Guards: the folder is 0700 and no symlink; only regular files owned by
 * the user, at most AGENT_REQUEST_MAX_BYTES; unknown versions and kinds are
 * answered with why; expired requests are dropped unanswered. A request is
 * claimed by renaming it to `<uuid>.working`, so the MCP process can tell
 * "not taken" (it removes its own file) from "still running".
 */
export class AgentRequestInbox {
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly running = new Set<Promise<void>>();
  private readonly now: () => Date;
  private readonly log: (line: string) => void;

  constructor(private readonly options: AgentRequestInboxOptions) {
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((line) => console.log(line));
  }

  /** The folder, created 0700 when missing and set back to 0700 when not. False when it is unsafe to use. */
  private prepareFolder(): boolean {
    const { folder } = this.options;
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const stats = lstatSync(folder);
    if (!stats.isDirectory() || !ownedByUs(stats)) {
      this.log(`agent requests: ${folder} is not a folder owned by this user; agent requests are off`);
      return false;
    }
    if ((stats.mode & 0o777) !== 0o700) {
      chmodSync(folder, 0o700);
    }
    return true;
  }

  /** At start: claims from a previous run (the app quit mid-request), and old results and temp files nobody collected. */
  private sweep(): void {
    const cutoff = this.now().getTime() - AGENT_RESULT_MAX_AGE_MS;
    for (const name of readdirSync(this.options.folder)) {
      const path = join(this.options.folder, name);
      try {
        const stats = lstatSync(path);
        if (name.endsWith('.working') || (!AGENT_REQUEST_FILE.test(name) && stats.mtimeMs < cutoff)) {
          rmSync(path, { force: true });
        }
      } catch (error) {
        if (!isMissing(error)) {
          this.log(`agent requests: could not sweep ${name}: ${errorText(error)}`);
        }
      }
    }
  }

  start(): void {
    try {
      if (!this.prepareFolder()) {
        return;
      }
      this.sweep();
      if (this.options.watch ?? true) {
        this.watcher = watch(this.options.folder, (_event, name) => {
          if (typeof name === 'string' && AGENT_REQUEST_FILE.test(name)) {
            this.take(name);
          }
        });
        this.watcher.on('error', (error) => this.log(`agent requests: watch failed: ${errorText(error)}`));
      }
      const rescanMs = this.options.rescanMs ?? RESCAN_MS;
      if (rescanMs > 0) {
        this.timer = setInterval(() => void this.scan(), rescanMs);
        this.timer.unref();
      }
      void this.scan();
    } catch (error) {
      this.log(`agent requests: could not start: ${errorText(error)}`);
    }
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Takes every request waiting in the folder; settles when they are answered. */
  async scan(): Promise<void> {
    let names: string[];
    try {
      names = readdirSync(this.options.folder);
    } catch (error) {
      this.log(`agent requests: could not read the folder: ${errorText(error)}`);
      return;
    }
    for (const name of names) {
      if (AGENT_REQUEST_FILE.test(name)) {
        this.take(name);
      }
    }
    await this.settled();
  }

  /** Settles when every request taken so far is answered. */
  async settled(): Promise<void> {
    await Promise.all([...this.running]);
  }

  private take(name: string): void {
    const run = this.answer(name).catch((error: unknown) => this.log(`agent requests: ${name}: ${errorText(error)}`));
    this.running.add(run);
    void run.finally(() => this.running.delete(run));
  }

  /** Writes the result next to the request: a temp file first, then the rename, so the reader never sees half of it. */
  private writeResult(id: string, result: AgentRequestResult): void {
    const temp = join(this.options.folder, `.${id}.result.tmp`);
    const fd = openSync(temp, 'w', 0o600);
    try {
      writeSync(fd, JSON.stringify(result));
    } finally {
      closeSync(fd);
    }
    renameSync(temp, join(this.options.folder, `${id}.result.json`));
  }

  private async answer(name: string): Promise<void> {
    const id = AGENT_REQUEST_FILE.exec(name)?.[1];
    if (!id) {
      return;
    }
    const path = join(this.options.folder, name);
    let stats: Stats;
    try {
      stats = lstatSync(path);
    } catch (error) {
      // Taken already (the watcher and a scan both saw it), or withdrawn by the MCP process.
      if (isMissing(error)) {
        return;
      }
      throw error;
    }
    if (stats.isSymbolicLink() || !stats.isFile() || !ownedByUs(stats)) {
      rmSync(path, { force: true });
      this.log(`agent requests: dropped ${name}: not a regular file owned by this user`);
      return;
    }
    const working = join(this.options.folder, `${id}.working`);
    try {
      renameSync(path, working);
    } catch (error) {
      if (isMissing(error)) {
        return;
      }
      throw error;
    }
    try {
      if (stats.size > AGENT_REQUEST_MAX_BYTES) {
        this.writeResult(id, errorResult(`request too large (${stats.size} bytes, at most ${AGENT_REQUEST_MAX_BYTES})`));
        return;
      }
      const check = parseAgentRequest(readFileSync(working, 'utf8'));
      if (!check.ok) {
        this.log(`agent requests: refused ${name}: ${check.error}`);
        this.writeResult(id, errorResult(check.error));
        return;
      }
      if (Date.parse(check.request.expiresAt) <= this.now().getTime()) {
        this.log(`agent requests: dropped ${name}: expired at ${check.request.expiresAt}`);
        return;
      }
      let result: AgentRequestResult;
      try {
        result = await this.options.handle(check.request);
      } catch (error) {
        result = errorResult(`PostPile failed: ${errorText(error)}`);
      }
      this.writeResult(id, result);
    } finally {
      rmSync(working, { force: true });
    }
  }
}
