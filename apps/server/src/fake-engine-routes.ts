import type { Hono } from 'hono';
import { z } from 'zod';
import type { EngineService } from '@postpile/engine';

/**
 * The engine methods an MCP server needs: its eleven reads plus the three
 * asks that the real app answers from its request folder. Nothing else is
 * callable through the route below.
 */
export const SHARED_ENGINE_METHODS = [
  'getPr',
  'getTopic',
  'listTopics',
  'search',
  'getViewer',
  'getTeamMembers',
  'prOverlaps',
  'lastSyncReport',
  'recordedSyncProgress',
  'recordedAppVersion',
  'listPrNotes',
  'refreshNow',
  'proposeTopicChange',
  'notePr',
] as const;

export type SharedEngineMethod = (typeof SHARED_ENGINE_METHODS)[number];

function isSharedEngineMethod(name: string): name is SharedEngineMethod {
  return (SHARED_ENGINE_METHODS as readonly string[]).includes(name);
}

const callBody = z.object({ args: z.array(z.unknown()).max(4) });

/**
 * Sample data only: `pnpm cli mcp --api <url>` reaches the fake server's
 * engine here, so what an MCP client files shows in the UI that server
 * serves, and the other way round. A real server never gets this route: its
 * MCP server reads the database and asks the app through files.
 * Behind the same token as every /api route.
 */
export function addFakeEngineRoutes(app: Hono, engine: EngineService): void {
  app.post('/api/fake/engine/:method', async (c) => {
    const method = c.req.param('method');
    if (!isSharedEngineMethod(method)) {
      return c.json({ error: `no shared engine method ${method}` }, 400);
    }
    const { args } = callBody.parse(await c.req.json());
    const call = engine[method] as (...callArgs: unknown[]) => Promise<unknown>;
    return c.json({ result: await call.apply(engine, args) });
  });
}
