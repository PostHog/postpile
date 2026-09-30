import { z } from 'zod';

// Turns an uncaught error into what is safe to send: the error class name,
// a message scrubbed of anything that could carry a PR title, a repo name, a
// real path or a username, and stack frames from the app's own bundle only.
// Used for the main process and server's uncaught exception/rejection
// handlers, and for the renderer's errors, which reach the engine through
// POST /api/telemetry before anything leaves the machine.

/** One stack frame inside the app bundle. Enough for PostHog to find the uploaded source map and resolve it. */
export interface SafeStackFrame {
  /** Path inside the bundle, e.g. "main/chunks/engine-from-env-abc123.js" or "renderer/assets/index-abc123.js". */
  file: string;
  line: number;
  column: number | null;
  /** posthog-cli's chunk id for that file (release builds only, see RELEASING.md); PostHog looks the source map up by it. */
  chunkId: string | null;
}

export interface SafeException {
  type: string;
  message: string;
  /** App-bundle frames only, newest first, oldest dropped past the cap. Empty when nothing qualified. */
  frames: SafeStackFrame[];
}

/** What a caller knows about an error before scrubbing. */
export interface RawException {
  type: string;
  message: string;
  stack: string | null;
}

const MAX_MESSAGE_LENGTH = 200;
const MAX_STACK_FRAMES = 10;

// A packaged or dev bundle always has one of these in its path; Node's own
// internals never do, so a frame without one is dropped rather than guessed
// at. node_modules frames are dropped outright (a dependency's own dist/).
const BUNDLE_MARKERS = ['/out/', '/dist/', '/.vite/', '.asar/'];
// Bundle file names are generated (name, hash, extension); anything else
// after a marker is not ours to send.
const BUNDLE_FILE = /^[A-Za-z0-9._/-]{1,200}$/;
// A class name as the code wrote it, or as the minifier renamed it.
const ERROR_TYPE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
const FRAME_LOCATION = /^(.+?):(\d+)(?::(\d+))?$/;

/**
 * URLs, anything with a slash (paths, `owner/repo`, branches), PR numbers
 * and double-quoted snippets (JSON.parse quotes its input) are replaced with
 * a placeholder: they can hold a username, a repo name or PR text.
 */
function scrubText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/[^\s'"()]*\/[^\s'"()]*/g, '[path]')
    .replace(/#\d+/g, '#[n]')
    .replace(/"[^"]*"/g, '"[text]"');
}

/** The part of a stack frame after the last bundle marker, e.g. "main/index.js:120:4)". Null when none matched. */
function bundleRelativeLocation(line: string): string | null {
  if (line.includes('node_modules')) {
    return null;
  }
  let start = -1;
  for (const marker of BUNDLE_MARKERS) {
    const at = line.lastIndexOf(marker);
    if (at !== -1) {
      start = Math.max(start, at + marker.length);
    }
  }
  return start === -1 ? null : line.slice(start).replace(/\)$/, '');
}

function parseFrame(line: string): Omit<SafeStackFrame, 'chunkId'> | null {
  const location = bundleRelativeLocation(line);
  const match = location ? FRAME_LOCATION.exec(location) : null;
  if (!match || !BUNDLE_FILE.test(match[1]!)) {
    return null;
  }
  return { file: match[1]!, line: Number(match[2]), column: match[3] ? Number(match[3]) : null };
}

/**
 * posthog-cli's injected snippet runs `globalThis._posthogChunkIds[new
 * Error().stack] = chunkId` as each bundle file loads. The first bundle frame
 * of that stack is the file itself, so this maps bundle file to chunk id.
 * Anything not of that shape gives an empty map.
 */
function chunkIdsByFile(posthogChunkIds: unknown): Map<string, string> {
  const byFile = new Map<string, string>();
  if (typeof posthogChunkIds !== 'object' || posthogChunkIds === null) {
    return byFile;
  }
  for (const [stack, chunkId] of Object.entries(posthogChunkIds)) {
    if (typeof chunkId !== 'string') {
      continue;
    }
    const frame = stack
      .split('\n')
      .map(parseFrame)
      .find((found) => found !== null);
    if (frame) {
      byFile.set(frame.file, chunkId);
    }
  }
  return byFile;
}

function scrubFrames(stack: string, chunkIds: Map<string, string>): SafeStackFrame[] {
  return stack
    .split('\n')
    .slice(1) // the first line repeats the message
    .map(parseFrame)
    .filter((frame) => frame !== null)
    .slice(0, MAX_STACK_FRAMES)
    .map((frame) => ({ ...frame, chunkId: chunkIds.get(frame.file) ?? null }));
}

/** Scrubs a type/message/stack triple. `posthogChunkIds` is `globalThis._posthogChunkIds` of the process the stack came from. */
export function scrubException(raw: RawException, posthogChunkIds?: unknown): SafeException {
  return {
    type: ERROR_TYPE.test(raw.type) ? raw.type : 'Error',
    message: scrubText(raw.message).slice(0, MAX_MESSAGE_LENGTH),
    frames: raw.stack ? scrubFrames(raw.stack, chunkIdsByFile(posthogChunkIds)) : [],
  };
}

/** Never throws. A thrown non-Error value gets type "Error", its scrubbed text and no frames: it has no stack of its own. */
export function safeExceptionInfo(error: unknown, posthogChunkIds?: unknown): SafeException {
  if (!(error instanceof Error)) {
    return scrubException({ type: 'Error', message: String(error), stack: null });
  }
  return scrubException({ type: error.constructor?.name || 'Error', message: error.message, stack: error.stack ?? null }, posthogChunkIds);
}

// -----------------------------------------------------------------------
// Renderer errors
// -----------------------------------------------------------------------

/** The POST /api/telemetry event name for a renderer error. The route hands it to captureRendererException, never to capture. */
export const RENDERER_EXCEPTION_EVENT = 'renderer_exception';

/**
 * What the renderer sends. Raw on purpose: it only travels to the local
 * server, and the scrubbing above runs in the engine before anything leaves
 * the machine, so there is one scrubber and not a second copy in the
 * renderer. The caps keep a runaway error from posting megabytes.
 */
export const rendererExceptionProps = z
  .object({
    source: z.enum(['window_error', 'unhandled_rejection', 'react_render']),
    type: z.string().max(200),
    message: z.string().max(5000),
    stack: z.string().max(20_000).nullable(),
    /** The renderer's `globalThis._posthogChunkIds` (stack -> chunk id); empty in dev and in builds without source map upload. */
    chunk_ids: z.record(z.string().max(2000), z.string().max(100)).refine((ids) => Object.keys(ids).length <= 50, 'too many chunk ids'),
  })
  .strict();

export type RendererExceptionProps = z.infer<typeof rendererExceptionProps>;
