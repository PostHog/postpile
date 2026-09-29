// Turns an uncaught error into what is safe to send: the error class name
// and a message and stack scrubbed of anything that could carry a PR title,
// a repo name, a real path or a username. Used for both the main process and
// the server's uncaught exception/rejection handlers.

export interface SafeException {
  type: string;
  message: string;
  /** file:line pairs from the app's own bundle only, oldest frames dropped, newest first. Null when nothing qualified. */
  stack: string | null;
}

const MAX_MESSAGE_LENGTH = 200;
const MAX_STACK_FRAMES = 10;

// A packaged or dev bundle always has one of these in its path; node_modules
// and Node's own internals never do, so a frame without one is dropped
// rather than guessed at.
const BUNDLE_MARKERS = ['/out/', '/dist/', '/.vite/', '.asar/'];

/** Absolute paths and URLs replaced with a placeholder: they can hold a username, a repo name or a PR link. */
function scrubText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '[url]')
    .replace(/(?:\/[A-Za-z0-9._-]+){2,}/g, '[path]')
    .replace(/~\/[^\s:]+/g, '[path]');
}

/** The part of a stack frame after the last bundle marker, e.g. "main/index.js:120:4". Null when no marker matched. */
function bundleRelativePath(line: string): string | null {
  for (const marker of BUNDLE_MARKERS) {
    const at = line.indexOf(marker);
    if (at !== -1) {
      return line.slice(at + marker.length).replace(/\)$/, '');
    }
  }
  return null;
}

function scrubStack(stack: string): string | null {
  const frames = stack
    .split('\n')
    .slice(1) // the first line repeats the message
    .map(bundleRelativePath)
    .filter((frame): frame is string => frame !== null)
    .slice(0, MAX_STACK_FRAMES);
  return frames.length > 0 ? frames.join('\n') : null;
}

/** Never throws: an error that is not an Error instance still gets a type and a best-effort message. */
export function safeExceptionInfo(error: unknown): SafeException {
  const err = error instanceof Error ? error : new Error(scrubText(String(error)));
  return {
    type: err.constructor?.name || 'Error',
    message: scrubText(err.message).slice(0, MAX_MESSAGE_LENGTH),
    stack: err.stack ? scrubStack(err.stack) : null,
  };
}
