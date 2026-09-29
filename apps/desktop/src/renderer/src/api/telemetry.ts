import type { RendererTelemetryEvent, TelemetryEventProps } from '@postpile/core';
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
