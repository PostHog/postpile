import type { RendererExceptionProps, SafeException, TelemetryEventName, TelemetryEventProps } from '@postpile/core';
import { safeExceptionInfo, sanitizeTelemetryProps, scrubException } from '@postpile/core';
import { hashedTelemetryId } from '@postpile/core/telemetry-identity';
import { PostHog, type PostHogOptions } from 'posthog-node';
import { loadOrCreateInstallId } from './install-id.ts';
import { telemetryEnabled } from './telemetry-env.ts';

// Public project key and host for PostHog's own "PostPile" project (id
// 635117, US cloud). A client-side/public API key: fine to commit, it can
// only ever send events in, never read data out.
export const TELEMETRY_API_KEY = 'phc_t9DcYfh6V9x9GroikAo6ugqosWQzamAZomKJAvTwMGSY';
export const TELEMETRY_HOST = 'https://us.i.posthog.com';

export interface TelemetryPersonInfo {
  appVersion: string;
  osVersion: string;
  arch: string;
  /** The viewer's teams/orgs include the PostHog org. */
  isPosthogMember: boolean;
  /** Whether `claude` was found on PATH, whatever its login state. */
  agentAvailable: boolean;
}

/** The one thing every app entry point needs at the end: flush what is queued before the process exits. */
export interface Telemetry {
  capture<K extends TelemetryEventName>(event: K, props: TelemetryEventProps<K>): void;
  /** Person properties via $set (DESIGN.md): app_version, os_version, arch, is_posthog_member, agent_available. Never login, name or email. */
  identifyPerson(info: TelemetryPersonInfo): void;
  /** Switches from the random install id to the hashed GitHub id, and links the two so PostHog treats them as one person. */
  setViewerIdentity(githubDatabaseId: number): void;
  /** An uncaught error in this process (main or server), scrubbed before it is sent. */
  captureException(error: unknown, context?: Record<string, unknown>): void;
  /** A renderer error from POST /api/telemetry, scrubbed here: the renderer sends it raw to the local server only. */
  captureRendererException(report: RendererExceptionProps): void;
  shutdown(): Promise<void>;
}

/** Used whenever telemetry is off: every call is a no-op, so call sites never branch on whether it is enabled. */
export class NoopTelemetry implements Telemetry {
  capture<K extends TelemetryEventName>(_event: K, _props: TelemetryEventProps<K>): void {}
  identifyPerson(_info: TelemetryPersonInfo): void {}
  setViewerIdentity(_githubDatabaseId: number): void {}
  captureException(_error: unknown, _context?: Record<string, unknown>): void {}
  captureRendererException(_report: RendererExceptionProps): void {}
  async shutdown(): Promise<void> {}
}

/** How PostHog should read the frames, and what caught the error. */
interface ExceptionShape {
  platform: 'node:javascript' | 'web:javascript';
  mechanism: string;
}

// Mechanism names as posthog-js uses them for the same browser hooks.
const RENDERER_MECHANISMS: Record<RendererExceptionProps['source'], string> = {
  window_error: 'onerror',
  unhandled_rejection: 'onunhandledrejection',
  react_render: 'react_error_boundary',
};

/** Set by posthog-cli's injected snippet in release builds (RELEASING.md); undefined otherwise. */
function posthogChunkIds(): unknown {
  return (globalThis as { _posthogChunkIds?: unknown })._posthogChunkIds;
}

/** Carries a scrubbed type/message pair into captureException without re-exposing the original (possibly unsafe) error. */
class NamedError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

export interface PostHogTelemetryOptions {
  installId: string;
  appVersion: string;
  profile: string;
  apiKey?: string;
  host?: string;
  /** One line per dropped prop or queued exception; defaults to console.log. */
  log?: (line: string) => void;
  /** Test-only: replaces posthog-node's network layer, so tests see exactly what would have been sent. */
  fetch?: PostHogOptions['fetch'];
}

/** Real telemetry over posthog-node. Every event carries the super properties; every prop is guarded before it leaves the process. */
export class PostHogTelemetry implements Telemetry {
  private readonly client: PostHog;
  private readonly superProps: Record<string, unknown>;
  private readonly warnedProps = new Set<string>();
  private readonly log: (line: string) => void;
  private distinctId: string;

  constructor(options: PostHogTelemetryOptions) {
    this.client = new PostHog(options.apiKey ?? TELEMETRY_API_KEY, {
      host: options.host ?? TELEMETRY_HOST,
      fetch: options.fetch,
      // Flushed explicitly on shutdown(); no reason to batch in a desktop app that is rarely quiet for long.
      flushAt: 1,
    });
    this.distinctId = options.installId;
    this.log = options.log ?? ((line) => console.log(line));
    this.superProps = { app_version: options.appVersion, profile: options.profile, $process_person_profile: true };
  }

  private warnOnce(key: string): void {
    if (this.warnedProps.has(key)) {
      return;
    }
    this.warnedProps.add(key);
    this.log(`telemetry: dropped prop "${key}" (too long or looked like a path/repo/PR reference)`);
  }

  private clean<T extends Record<string, unknown>>(props: T): Partial<T> {
    return sanitizeTelemetryProps(props, (key) => this.warnOnce(key));
  }

  capture<K extends TelemetryEventName>(event: K, props: TelemetryEventProps<K>): void {
    this.client.capture({
      distinctId: this.distinctId,
      event,
      properties: { ...this.superProps, ...this.clean(props as Record<string, unknown>) },
    });
  }

  identifyPerson(info: TelemetryPersonInfo): void {
    this.client.identify({
      distinctId: this.distinctId,
      properties: this.clean({
        app_version: info.appVersion,
        os_version: info.osVersion,
        arch: info.arch,
        is_posthog_member: info.isPosthogMember,
        agent_available: info.agentAvailable,
      }),
    });
  }

  setViewerIdentity(githubDatabaseId: number): void {
    const hashed = hashedTelemetryId(githubDatabaseId);
    if (hashed === this.distinctId) {
      return;
    }
    this.client.alias({ distinctId: this.distinctId, alias: hashed });
    this.distinctId = hashed;
  }

  /**
   * Sends the scrubbed exception with an `$exception_list` built here rather
   * than parsed by posthog-node from a stack string: the frames carry the
   * bundle-relative file, line, column and posthog-cli chunk id, which is
   * what PostHog needs to find the uploaded source map (the SDK would look
   * chunk ids up by the full, unscrubbed path). The list passed as a
   * property replaces the one the SDK builds. posthog-node still adds
   * `$release_id` from the injected `_posthogReleaseId`, so the exception
   * belongs to the release that built this bundle.
   */
  private sendException(info: SafeException, shape: ExceptionShape, context: Record<string, unknown>): void {
    // PostHog wants the oldest frame first and the throwing frame last.
    const frames = info.frames.toReversed().map((frame) => ({
      platform: shape.platform,
      filename: frame.file,
      function: '?',
      lineno: frame.line,
      colno: frame.column ?? undefined,
      in_app: true,
      chunk_id: frame.chunkId ?? undefined,
    }));
    const exception = {
      type: info.type,
      value: info.message,
      mechanism: { type: shape.mechanism, handled: false, synthetic: false },
      stacktrace: frames.length > 0 ? { type: 'raw', frames } : undefined,
    };
    const properties = { ...this.superProps, ...this.clean(context), $exception_list: [exception] };
    this.client.captureException(new NamedError(info.type, info.message), this.distinctId, properties);
  }

  captureException(error: unknown, context: Record<string, unknown> = {}): void {
    const info = safeExceptionInfo(error, posthogChunkIds());
    this.sendException(info, { platform: 'node:javascript', mechanism: 'generic' }, { process_type: 'main', ...context });
  }

  captureRendererException(report: RendererExceptionProps): void {
    // The renderer's own chunk ids: its bundle files are not loaded in this process.
    const info = scrubException({ type: report.type, message: report.message, stack: report.stack }, report.chunk_ids);
    this.sendException(info, { platform: 'web:javascript', mechanism: RENDERER_MECHANISMS[report.source] }, { process_type: 'renderer' });
  }

  async shutdown(): Promise<void> {
    await this.client.shutdown();
  }
}

export interface TelemetryFromEnvOptions {
  env: NodeJS.ProcessEnv;
  appVersion: string;
  osVersion: string;
  arch: string;
  /** Where the install id lives; see paths.ts. Undefined: a fresh id for this process only (tests, no-lock reads). */
  telemetryIdFile?: string;
  log?: (line: string) => void;
}

/** Builds the real client when telemetry is allowed, a no-op otherwise. Never throws: a broken env falls back to no-op. */
export function telemetryFromEnv(options: TelemetryFromEnvOptions): Telemetry {
  if (!telemetryEnabled(options.env)) {
    return new NoopTelemetry();
  }
  return new PostHogTelemetry({
    installId: loadOrCreateInstallId(options.telemetryIdFile),
    appVersion: options.appVersion,
    profile: options.env.POSTPILE_PROFILE === 'dev' ? 'dev' : 'default',
    log: options.log,
  });
}
