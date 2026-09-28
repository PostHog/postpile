import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

// Lightweight signals from one Claude Code session transcript
// (~/.claude/projects/<dir>/<session>.jsonl): where it ran, when, its title,
// the first few prompts the user typed and the newest compaction summary.
// Never the transcript itself. Lines are streamed, and only the few that can
// hold a signal are parsed; tool results can be megabytes long.

/** Prompts kept per session. */
export const PROMPTS_PER_SESSION = 3;
/** Characters kept per prompt. */
export const PROMPT_MAX_CHARS = 300;
/** Characters kept of the compaction summary. */
export const COMPACTION_MAX_CHARS = 500;

export interface SessionSignals {
  sessionId: string;
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  title: string | null;
  prompts: string[];
  /** The newest compaction or summary record, trimmed. */
  compaction: string | null;
  /** Started by a program through the SDK, not typed by the user. */
  sdk: boolean;
}

interface TranscriptLine {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  toolUseResult?: unknown;
  origin?: { kind?: string };
  promptSource?: string;
  aiTitle?: string;
  summary?: string;
  message?: { content?: unknown };
}

const TIMESTAMP = /"timestamp":"(\d{4}-\d{2}-\d{2}T[^"]+)"/;
const CWD = /"cwd":"((?:[^"\\]|\\.)+)"/;
const ENTRYPOINT = /"entrypoint":"([^"]+)"/;
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
/** Prompt sources that are not the user typing: hooks, task notifications, programs. */
const MACHINE_PROMPT_SOURCES = new Set(['system', 'sdk']);
/** Openings of messages Claude Code writes into the user turn itself. */
const MACHINE_OPENINGS = ['<', 'Caveat:', 'This session is being continued', '[Request interrupted'];

/** First non-empty line starts like code, data or a log, not like something typed. */
const BLOB_OPENING = /^(?:[{[]|```|\$ |diff --git|\+\+\+ |--- |Traceback|\s*at \S+ \(|\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|[A-Z][A-Za-z]*(?:Error|Exception)\b)/;

/** Enough letters-and-spaces to read as a sentence fragment. */
function looksLikeProse(line: string): boolean {
  return (line.match(/[A-Za-z]{2,}/g) ?? []).length >= 4;
}

/**
 * A prompt that is mostly pasted material (JSON, logs, stack traces, diffs):
 * it opens like one, or it is long and most of its lines are not prose.
 */
export function isPastedBlob(text: string): boolean {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const first = lines[0]?.trim() ?? '';
  if (BLOB_OPENING.test(first)) {
    return true;
  }
  if (lines.length < 20) {
    return false;
  }
  const prose = lines.filter(looksLikeProse).length;
  return prose / lines.length < 0.4;
}

function contentText(content: unknown): string | null {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const texts: string[] = [];
  for (const block of content as { type?: string; text?: string }[]) {
    if (block.type === 'tool_result') {
      return null;
    }
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    }
  }
  return texts.length > 0 ? texts.join('\n') : null;
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** The user's own typed prompt from a transcript line, cleaned and cut, or null. */
export function typedPrompt(line: TranscriptLine): string | null {
  if (line.type !== 'user' || line.isSidechain || line.isMeta || line.isCompactSummary || line.toolUseResult !== undefined) {
    return null;
  }
  if (line.origin?.kind !== undefined && line.origin.kind !== 'human') {
    return null;
  }
  if (line.promptSource !== undefined && MACHINE_PROMPT_SOURCES.has(line.promptSource)) {
    return null;
  }
  const raw = contentText(line.message?.content);
  if (raw === null) {
    return null;
  }
  const text = raw.replace(SYSTEM_REMINDER, '').trim();
  if (text === '' || MACHINE_OPENINGS.some((opening) => text.startsWith(opening)) || isPastedBlob(text)) {
    return null;
  }
  return oneLine(text, PROMPT_MAX_CHARS);
}

/** Drops Claude Code's "This session is being continued ... Summary:" lead-in, which says nothing. */
function stripCompactionPreamble(text: string): string {
  const withoutLead = text.replace(/^This session is being continued[^\n]*\n+/, '');
  const summaryAt = withoutLead.indexOf('Summary:');
  return summaryAt >= 0 && summaryAt < 400 ? withoutLead.slice(summaryAt + 'Summary:'.length) : withoutLead;
}

function parse(line: string): TranscriptLine | null {
  try {
    return JSON.parse(line) as TranscriptLine;
  } catch {
    return null;
  }
}

/** Does this raw line need a JSON parse? Most lines (assistant turns, tool output, attachments) do not. */
function worthParsing(line: string, wantPrompts: boolean): boolean {
  if (line.startsWith('{"type":"ai-title"') || line.startsWith('{"type":"summary"')) {
    return true;
  }
  if (line.includes('"isCompactSummary":true')) {
    return true;
  }
  return wantPrompts && line.includes('"type":"user"') && !line.includes('"isSidechain":true');
}

export async function readSessionSignals(file: string, sessionId: string): Promise<SessionSignals> {
  const signals: SessionSignals = {
    sessionId,
    cwd: null,
    startedAt: null,
    endedAt: null,
    title: null,
    prompts: [],
    compaction: null,
    sdk: false,
  };
  let entrypointSeen = false;
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of lines) {
    const time = TIMESTAMP.exec(line)?.[1];
    if (time) {
      signals.startedAt ??= time;
      signals.endedAt = time;
    }
    if (signals.cwd === null) {
      const cwd = CWD.exec(line)?.[1];
      signals.cwd = cwd ? cwd.replace(/\\(.)/g, '$1') : null;
    }
    if (!entrypointSeen) {
      const entrypoint = ENTRYPOINT.exec(line)?.[1];
      if (entrypoint) {
        entrypointSeen = true;
        signals.sdk = entrypoint.startsWith('sdk');
      }
    }
    if (!worthParsing(line, signals.prompts.length < PROMPTS_PER_SESSION)) {
      continue;
    }
    const parsed = parse(line);
    if (!parsed) {
      continue;
    }
    if (parsed.type === 'ai-title' && parsed.aiTitle) {
      signals.title = oneLine(parsed.aiTitle, 120);
    } else if (parsed.type === 'summary' && parsed.summary) {
      signals.compaction = oneLine(parsed.summary, COMPACTION_MAX_CHARS);
    } else if (parsed.isCompactSummary) {
      const text = contentText(parsed.message?.content);
      if (text) {
        signals.compaction = oneLine(stripCompactionPreamble(text), COMPACTION_MAX_CHARS);
      }
    } else if (signals.prompts.length < PROMPTS_PER_SESSION) {
      const prompt = typedPrompt(parsed);
      if (prompt !== null && !signals.prompts.includes(prompt)) {
        signals.prompts.push(prompt);
      }
    }
  }
  return signals;
}
