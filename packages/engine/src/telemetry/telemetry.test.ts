import { gunzipSync } from 'node:zlib';
import type { PostHogOptions } from 'posthog-node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoopTelemetry, PostHogTelemetry } from './telemetry.ts';

type PostHogFetch = NonNullable<PostHogOptions['fetch']>;

interface SentEvent {
  event?: string;
  properties?: Record<string, unknown>;
  distinct_id?: string;
}

/** A fetch that never hits the network: gunzips posthog-node's real batch body, so tests see exactly what would have been sent. */
function fakeFetch(): { fetch: PostHogFetch; sent: SentEvent[] } {
  const sent: SentEvent[] = [];
  const fetch: PostHogFetch = async (_url, options) => {
    if (options.body) {
      const text = gunzipSync(Buffer.from(options.body as unknown as ArrayBuffer)).toString('utf8');
      const payload = JSON.parse(text) as { batch?: SentEvent[] };
      sent.push(...(payload.batch ?? []));
    }
    return { status: 200, text: async () => '{"status":"Ok"}', json: async () => ({ status: 'Ok' }) };
  };
  return { fetch, sent };
}

describe('NoopTelemetry', () => {
  it('never throws, whatever is called', async () => {
    const telemetry = new NoopTelemetry();
    telemetry.capture('app_active', {});
    telemetry.identifyPerson({ appVersion: '1', osVersion: '1', arch: 'arm64', isPosthogMember: false, agentAvailable: false });
    telemetry.setViewerIdentity(1);
    telemetry.captureException(new Error('boom'));
    telemetry.captureRendererException({ source: 'window_error', type: 'Error', message: 'boom', stack: null, chunk_ids: {} });
    await expect(telemetry.shutdown()).resolves.toBeUndefined();
  });
});

describe('PostHogTelemetry', () => {
  it('sends the super properties and the event props together', async () => {
    const { fetch, sent } = fakeFetch();
    const telemetry = new PostHogTelemetry({ installId: 'install-1', appVersion: '0.1.0', profile: 'default', fetch });
    telemetry.capture('sync_completed', {
      duration_ms: 1200,
      prs_fetched: 3,
      new_events: 1,
      agent_calls: 2,
      agent_failures: 0,
      cost_usd: 0.02,
      stopped_at_cap: false,
      trigger: 'manual',
      gh_requests: 12,
    });
    await telemetry.shutdown();

    const found = sent.find((event) => event.event === 'sync_completed')!;
    expect(found.distinct_id).toBe('install-1');
    expect(found.properties).toMatchObject({ app_version: '0.1.0', profile: 'default', prs_fetched: 3, trigger: 'manual' });
  });

  it('drops a prop that looks like a path or is too long, and only warns once', async () => {
    const { fetch } = fakeFetch();
    const log = vi.fn();
    const telemetry = new PostHogTelemetry({ installId: 'install-1', appVersion: '0.1.0', profile: 'default', fetch, log });
    // @ts-expect-error deliberately sending a disallowed shape, to exercise the guard
    telemetry.capture('app_active', { repo: 'acme/app' });
    // @ts-expect-error same as above
    telemetry.capture('app_active', { repo: 'acme/app' });
    await telemetry.shutdown();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain('repo');
  });

  it('switches identity with an alias once the viewer is known', async () => {
    const { fetch, sent } = fakeFetch();
    const telemetry = new PostHogTelemetry({ installId: 'install-1', appVersion: '0.1.0', profile: 'default', fetch });
    telemetry.setViewerIdentity(424242);
    telemetry.capture('app_active', {});
    await telemetry.shutdown();

    const all = sent;
    const alias = all.find((event) => event.event === '$create_alias');
    expect(alias).toBeTruthy();
    const active = all.find((event) => event.event === 'app_active')!;
    expect(active.distinct_id).not.toBe('install-1');
    expect(active.distinct_id).toHaveLength(64);
  });

  it('identifies the person via $set, never with login/name/email fields', async () => {
    const { fetch, sent } = fakeFetch();
    const telemetry = new PostHogTelemetry({ installId: 'install-1', appVersion: '0.1.0', profile: 'default', fetch });
    telemetry.identifyPerson({ appVersion: '0.1.0', osVersion: '15.0', arch: 'arm64', isPosthogMember: true, agentAvailable: true });
    await telemetry.shutdown();

    const identify = sent.find((event) => event.event === '$identify')!;
    const props = identify.properties as Record<string, unknown>;
    expect(props.$set).toMatchObject({ is_posthog_member: true, agent_available: true, arch: 'arm64' });
    expect(JSON.stringify(props)).not.toMatch(/login|email/i);
  });

  describe('exceptions', () => {
    const app = '/Applications/PostPile.app/Contents/Resources/app.asar/out';
    const injected = globalThis as { _posthogReleaseId?: string };

    afterEach(() => {
      delete injected._posthogReleaseId;
    });

    it('sends a renderer error scrubbed, with frames PostHog can resolve and the injected release', async () => {
      injected._posthogReleaseId = 'release-0.12.0';
      const { fetch, sent } = fakeFetch();
      const telemetry = new PostHogTelemetry({ installId: 'install-1', appVersion: '0.12.0', profile: 'default', fetch });
      telemetry.captureRendererException({
        source: 'unhandled_rejection',
        type: 'TypeError',
        message: 'no tile for acme/app#12 at /Users/alice/code',
        stack: [
          'TypeError: no tile',
          `    at Xe (file://${app}/renderer/assets/index-B4x.js:1:4821)`,
          `    at Qa (file://${app}/renderer/assets/index-B4x.js:1:900)`,
        ].join('\n'),
        chunk_ids: { [`Error\n    at file://${app}/renderer/assets/index-B4x.js:1:10`]: '0197e6db-9a73-7b91-9e80-4e1b7158db5c' },
      });
      await telemetry.shutdown();

      const exception = sent.find((event) => event.event === '$exception')!;
      const props = exception.properties as Record<string, unknown>;
      expect(props).toMatchObject({ $release_id: 'release-0.12.0', app_version: '0.12.0', process_type: 'renderer' });
      const [entry] = props.$exception_list as { type: string; value: string; mechanism: unknown; stacktrace: { frames: unknown[] } }[];
      expect(entry!.type).toBe('TypeError');
      expect(entry!.value).toBe('no tile for [path] at [path]');
      expect(entry!.mechanism).toMatchObject({ type: 'onunhandledrejection', handled: false });
      // Oldest first: the throwing frame (Xe) comes last.
      expect(entry!.stacktrace.frames).toEqual([
        { platform: 'web:javascript', filename: 'renderer/assets/index-B4x.js', function: '?', lineno: 1, colno: 900, in_app: true, chunk_id: '0197e6db-9a73-7b91-9e80-4e1b7158db5c' },
        { platform: 'web:javascript', filename: 'renderer/assets/index-B4x.js', function: '?', lineno: 1, colno: 4821, in_app: true, chunk_id: '0197e6db-9a73-7b91-9e80-4e1b7158db5c' },
      ]);
      expect(JSON.stringify(props)).not.toMatch(/alice|acme|Applications/);
    });

    it('sends a main process error as node frames, without a release when nothing was injected', async () => {
      const { fetch, sent } = fakeFetch();
      const telemetry = new PostHogTelemetry({ installId: 'install-1', appVersion: '0.12.0', profile: 'default', fetch });
      const error = new RangeError('bad');
      error.stack = `RangeError: bad\n    at sync (${app}/main/chunks/engine-from-env-Dk2a.js:35040:12)`;
      telemetry.captureException(error);
      await telemetry.shutdown();

      const props = sent.find((event) => event.event === '$exception')!.properties as Record<string, unknown>;
      expect(props.$release_id).toBeUndefined();
      expect(props.process_type).toBe('main');
      const [entry] = props.$exception_list as { stacktrace: { frames: Record<string, unknown>[] } }[];
      expect(entry!.stacktrace.frames).toEqual([
        { platform: 'node:javascript', filename: 'main/chunks/engine-from-env-Dk2a.js', function: '?', lineno: 35040, colno: 12, in_app: true },
      ]);
    });
  });
});
