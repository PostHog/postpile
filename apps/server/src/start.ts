import { serve } from '@hono/node-server';
import type { AppConfig } from '@postpile/core';
import type { EngineService, Telemetry } from '@postpile/engine';
import { createApp } from './app.ts';

export interface ServerOptions {
  engine: EngineService;
  /** 0 picks a random free port. */
  port: number;
  /** Every /api request must carry it in TOKEN_HEADER. */
  token: string;
  /** Served at /api/config so the UI knows whether GitHub writes are allowed. */
  config: AppConfig;
  /** Where the renderer's POST /api/telemetry events go. Defaults to a no-op. */
  telemetry?: Telemetry;
}

export interface RunningServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Binds to 127.0.0.1 only. The API can approve PRs, so it never listens on the network. */
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const app = createApp(options.engine, options.token, options.config, options.telemetry);
  return new Promise((resolve) => {
    const server = serve({ fetch: app.fetch, port: options.port, hostname: '127.0.0.1' }, (info) => {
      resolve({
        port: info.port,
        url: `http://127.0.0.1:${info.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
