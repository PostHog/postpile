import { serve } from '@hono/node-server';
import type { AppConfig } from '@postpile/core';
import type { EngineService, Telemetry } from '@postpile/engine';
import { createApp } from './app.ts';
import { servePingFeed, type PingFeed } from './ping-feed.ts';
import { serveWebUi } from './web-ui.ts';
import type { UpdateSource } from './update-check.ts';

export interface ServerOptions {
  engine: EngineService;
  /** 0 picks a random free port. */
  port: number;
  /** Every /api request must carry it in TOKEN_HEADER. */
  token: string;
  /** Served at /api/config so the UI knows whether GitHub writes are allowed. */
  config: AppConfig;
  /** GET /api/update. Started with the server, stopped on close. */
  updates: UpdateSource;
  /** Where the renderer's POST /api/telemetry events go. Defaults to a no-op. */
  telemetry?: Telemetry;
  /** Called after every non-read API request, so the host can follow local actions (the Dock badge). */
  onWrite?: () => void;
  webRoot?: string | null;
  pings?: PingFeed;
}

export interface RunningServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Binds to 127.0.0.1 only. The API can approve PRs, so it never listens on the network. */
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const app = createApp(options.engine, options.token, options.config, options.updates, options.telemetry, options.onWrite);
  if (options.pings) {
    servePingFeed(app, options.pings, options.engine);
  }
  if (options.webRoot) {
    serveWebUi(app, options.webRoot, options.token);
  }
  options.updates.start();
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: options.port, hostname: '127.0.0.1' }, (info) => {
      resolve({
        port: info.port,
        url: `http://127.0.0.1:${info.port}`,
        close: () => {
          options.updates.stop();
          return new Promise((done) => server.close(() => done()));
        },
      });
    });
  });
}
