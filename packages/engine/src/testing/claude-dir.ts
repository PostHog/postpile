import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// A fake ~/.claude on disk for the work context sweep: CLAUDE.md with
// includes, memory files and session transcripts. Every test gets its own
// temp folder, so nothing ever reads the real one.

export interface FakeClaudeDir {
  /** Stands in for the home folder. */
  home: string;
  /** home/.claude */
  claudeDir: string;
  write(relativePath: string, text: string, modifiedAt?: Date): string;
  /** A session transcript under projects/<projectDir>/<sessionId>.jsonl. */
  session(projectDir: string, sessionId: string, lines: unknown[], modifiedAt?: Date): string;
  link(relativeLink: string, target: string): void;
  remove(): void;
}

export function makeFakeClaudeDir(): FakeClaudeDir {
  // realpath: on macOS the temp folder sits behind the /var -> /private/var link.
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'cm-claude-')));
  const claudeDir = join(home, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  const write = (relativePath: string, text: string, modifiedAt?: Date): string => {
    const path = join(home, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    if (modifiedAt) {
      utimesSync(path, modifiedAt, modifiedAt);
    }
    return path;
  };
  return {
    home,
    claudeDir,
    write,
    session: (projectDir, sessionId, lines, modifiedAt) =>
      write(
        join('.claude', 'projects', projectDir, `${sessionId}.jsonl`),
        lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'),
        modifiedAt,
      ),
    link: (relativeLink, target) => {
      const path = join(home, relativeLink);
      mkdirSync(dirname(path), { recursive: true });
      symlinkSync(target, path);
    },
    remove: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** A typed prompt line the way Claude Code writes it. */
export function userLine(text: unknown, at: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'user',
    isSidechain: false,
    message: { role: 'user', content: text },
    origin: { kind: 'human' },
    promptSource: 'typed',
    timestamp: at,
    cwd: '/Users/me/workspace/app',
    entrypoint: 'cli',
    ...extra,
  };
}
