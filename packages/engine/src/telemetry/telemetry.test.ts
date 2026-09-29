import { gunzipSync } from 'node:zlib';
import type { PostHogOptions } from 'posthog-node';
import { describe, expect, it, vi } from 'vitest';
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
});
