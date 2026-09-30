import type { RENDERER_EXCEPTION_EVENT, RendererExceptionProps, RendererTelemetryEvent, TelemetryEventProps } from '@postpile/core';
import { ErrorReporter } from '../lib/error-report.ts';
import { request } from './client.ts';

/**
 * Fire-and-forget: a dropped or slow telemetry call never blocks or breaks
 * the UI. The server (POST /api/telemetry) validates the event name and
 * props again against the same catalogue; this is just the allowed subset,
 * kept in one place so a typo here is a compile error, not a silent 400.
 */
export function sendTelemetry<K extends RendererTelemetryEvent>(event: K, props: TelemetryEventProps<K>): void {
  request('POST', '/api/telemetry', { event, props }).catch(() => {});
}

const rendererExceptionEvent: typeof RENDERER_EXCEPTION_EVENT = 'renderer_exception';

/** Same route, same fire-and-forget; the engine scrubs the error before it leaves, or drops it when telemetry is off. */
function sendRendererException(report: RendererExceptionProps): void {
  request('POST', '/api/telemetry', { event: rendererExceptionEvent, props: report }).catch(() => {});
}

/** One per window: main.tsx hooks it to the window's error events, ErrorBoundary to render errors. */
export const errorReporter = new ErrorReporter(sendRendererException, () => (globalThis as { _posthogChunkIds?: unknown })._posthogChunkIds);
