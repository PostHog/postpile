import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { format } from 'node:util';

// The packaged app's stdout goes nowhere, so main-process and server output
// (they share the process) also goes to a file: ~/Library/Logs/PostPile/main.log,
// or PostPile-dev for dev runs. Rotated at about 5 MB, 3 files kept:
// main.log, main.1.log, main.2.log.

export const LOG_FILE_NAME = 'main.log';
export const BROWSER_LOG_FILE_NAME = 'browser.log';
const MAX_BYTES = 5 * 1024 * 1024;
const FILES_KEPT = 3;

type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
const LEVELS: ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

/** POSTPILE_LOG_DIR, else ~/Library/Logs/PostPile (or PostPile-dev). */
export function logDirFromEnv(dev: boolean, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  return env.POSTPILE_LOG_DIR || join(home, 'Library', 'Logs', dev ? 'PostPile-dev' : 'PostPile');
}

export class FileLog {
  readonly file: string;
  private bytes: number;

  constructor(
    readonly dir: string,
    private readonly maxBytes: number = MAX_BYTES,
    private readonly baseName: string = 'main',
  ) {
    this.file = join(dir, `${baseName}.log`);
    mkdirSync(dir, { recursive: true });
    this.bytes = existsSync(this.file) ? statSync(this.file).size : 0;
  }

  /** main.log -> main.1.log -> main.2.log; the oldest goes. */
  private rotate(): void {
    const numbered = (index: number) => join(this.dir, `${this.baseName}.${index}.log`);
    rmSync(numbered(FILES_KEPT - 1), { force: true });
    for (let index = FILES_KEPT - 2; index >= 1; index -= 1) {
      if (existsSync(numbered(index))) {
        renameSync(numbered(index), numbered(index + 1));
      }
    }
    renameSync(this.file, numbered(1));
    this.bytes = 0;
  }

  write(level: string, message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${message}\n`;
    try {
      if (this.bytes + Buffer.byteLength(line) > this.maxBytes && this.bytes > 0) {
        this.rotate();
      }
      appendFileSync(this.file, line);
      this.bytes += Buffer.byteLength(line);
    } catch {
      // Logging must never take the app down.
    }
  }

  /** Every console call also lands in the file; the terminal still gets it. */
  captureConsole(): void {
    for (const level of LEVELS) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        this.write(level, format(...args));
        original(...args);
      };
    }
  }

  /**
   * Crashes and forgotten promise rejections, with their stacks. The
   * monitor event leaves Electron's own crash handling as it is.
   */
  captureUnhandled(): void {
    process.on('uncaughtExceptionMonitor', (error) => {
      this.write('fatal', `uncaught exception: ${error.stack ?? error.message}`);
    });
    process.on('unhandledRejection', (reason) => {
      const text = reason instanceof Error ? (reason.stack ?? reason.message) : format(reason);
      this.write('error', `unhandled rejection: ${text}`);
    });
  }
}
