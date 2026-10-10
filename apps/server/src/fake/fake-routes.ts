import type { Hono } from 'hono';
import { z } from 'zod';
import { FAKE_STEPS } from './fake-script.ts';
import type { FakeEngine } from './fake-engine.ts';

/**
 * Fake-mode only routes, behind the same token as the rest of /api:
 * GET /api/fake/steps lists the scripted steps (what each does, whether it
 * ran, which one the next sync delivers); POST /api/fake/advance {step}
 * runs one now, like a poll that brought that news.
 */
export function addFakeRoutes(app: Hono, engine: FakeEngine): void {
  app.get('/api/fake/steps', (c) => c.json({ steps: engine.script.steps(), nextDelivery: engine.script.nextDelivery() }));
  app.post('/api/fake/advance', async (c) => {
    const body = z.object({ step: z.enum(FAKE_STEPS) }).parse(await c.req.json());
    return c.json(engine.script.run(body.step));
  });
}
