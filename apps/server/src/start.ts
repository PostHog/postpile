import { serve } from '@hono/node-server';
import type { EngineService } from '@code-manager/engine';
import { createApp } from './app.ts';

export interface ServerOptions {
  engine: EngineService;
  /** 0 picks a random free port. */
  port: number;
  /** When set, every /api request must carry it in TOKEN_HEADER. */
  token: string | null;
}

export interface RunningServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

/** Binds to 127.0.0.1 only. The API can approve PRs, so it never listens on the network. */
export function startServer(options: ServerOptions): Promise<RunningServer> {
  const app = createApp(options.engine, options.token);
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
