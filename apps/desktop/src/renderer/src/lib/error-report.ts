import type { RendererExceptionProps } from '@postpile/core';

// Renderer errors for PostHog Error Tracking. The renderer only collects the
// raw error and posts it to the local server; the engine scrubs it (class
// name, app-bundle frames, no paths/URLs/PR text) before anything leaves the
// machine, and drops it when telemetry is off (DESIGN.md "Usage analytics").

export type RendererErrorSource = RendererExceptionProps['source'];

// Same caps as rendererExceptionProps in core: a longer report would be refused with 400.
const MAX_TYPE = 200;
const MAX_MESSAGE = 5000;
const MAX_STACK = 20_000;
const MAX_CHUNK_IDS = 50;
const MAX_CHUNK_KEY = 2000;
const MAX_CHUNK_ID = 100;
/** Per window load: an error in a render loop must not post forever. */
const MAX_REPORTS_PER_LOAD = 20;

/** posthog-cli's injected `globalThis._posthogChunkIds` (stack -> chunk id), trimmed to what the server accepts. */
function chunkIdsFrom(injected: unknown): Record<string, string> {
  const ids: Record<string, string> = {};
  if (typeof injected !== 'object' || injected === null) {
    return ids;
  }
  for (const [stack, chunkId] of Object.entries(injected)) {
    if (Object.keys(ids).length >= MAX_CHUNK_IDS) {
      break;
    }
    if (typeof chunkId === 'string' && stack.length <= MAX_CHUNK_KEY && chunkId.length <= MAX_CHUNK_ID) {
      ids[stack] = chunkId;
    }
  }
  return ids;
}

/** The POST body for one error. A thrown non-Error value becomes its text with no stack. */
export function rendererExceptionReport(error: unknown, source: RendererErrorSource, injectedChunkIds: unknown): RendererExceptionProps {
  const isError = error instanceof Error;
  return {
    source,
    type: (isError ? error.constructor?.name || 'Error' : 'Error').slice(0, MAX_TYPE),
    message: (isError ? error.message : String(error)).slice(0, MAX_MESSAGE),
    stack: isError && error.stack ? error.stack.slice(0, MAX_STACK) : null,
    chunk_ids: chunkIdsFrom(injectedChunkIds),
  };
}

/** Sends renderer errors, at most a few per load, and never throws: a failed report must not break the UI. */
export class ErrorReporter {
  private reported = 0;

  constructor(
    private readonly send: (report: RendererExceptionProps) => void,
    private readonly readChunkIds: () => unknown,
  ) {}

  report(error: unknown, source: RendererErrorSource): void {
    if (this.reported >= MAX_REPORTS_PER_LOAD) {
      return;
    }
    this.reported += 1;
    try {
      this.send(rendererExceptionReport(error, source, this.readChunkIds()));
    } catch {
      // Telemetry is best effort.
    }
  }
}

/** Uncaught errors and unhandled promise rejections of the window. Render errors go through ErrorBoundary instead. */
export function watchWindowErrors(target: EventTarget, reporter: ErrorReporter): void {
  target.addEventListener('error', (event) => {
    // A null error is a "Script error." without details; its message is all there is.
    const { error, message } = event as ErrorEvent;
    reporter.report(error ?? message, 'window_error');
  });
  target.addEventListener('unhandledrejection', (event) => {
    reporter.report((event as PromiseRejectionEvent).reason, 'unhandled_rejection');
  });
}
