import { z } from 'zod';

/**
 * zod 4 probes `new Function("")` when it builds an object schema, to decide
 * whether it may compile a fast parser. The renderer's CSP has no
 * `unsafe-eval`, so every load logged a script-src violation that hid real
 * CSP errors. Jitless skips the probe and the compiled parser; the renderer
 * parses little with zod, so nothing is lost.
 *
 * Import this before anything that builds a schema (`main.tsx` imports it first).
 */
z.config({ jitless: true });
