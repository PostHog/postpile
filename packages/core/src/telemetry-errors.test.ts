import { describe, expect, it } from 'vitest';
import { rendererExceptionProps, safeExceptionInfo, scrubException } from './telemetry-errors.ts';

const APP = '/Applications/PostPile.app/Contents/Resources/app.asar/out';

describe('safeExceptionInfo', () => {
  it('keeps the error class name and message', () => {
    const info = safeExceptionInfo(new TypeError('boom'));
    expect(info.type).toBe('TypeError');
    expect(info.message).toBe('boom');
  });

  it('scrubs a path or PR-ish text out of the message', () => {
    const info = safeExceptionInfo(new Error('failed reading /Users/alice/code/acme/app/src/index.ts'));
    expect(info.message).not.toContain('alice');
    expect(info.message).not.toContain('acme');
    expect(info.message).toContain('[path]');
  });

  it('scrubs a URL out of the message', () => {
    const info = safeExceptionInfo(new Error('GitHub said no: https://github.com/acme/app/pull/123'));
    expect(info.message).not.toContain('acme');
    expect(info.message).toContain('[url]');
  });

  it('scrubs a repo name, a PR number and a quoted snippet, keeps a quoted property name', () => {
    const repo = safeExceptionInfo(new Error('no tile for acme/app#12'));
    expect(repo.message).toBe('no tile for [path]');
    const json = safeExceptionInfo(new SyntaxError('Unexpected token \'F\', "Fix login for alice" is not valid JSON'));
    expect(json.message).toBe('Unexpected token \'F\', "[text]" is not valid JSON');
    const pr = safeExceptionInfo(new Error('PR #4521 is gone'));
    expect(pr.message).toBe('PR #[n] is gone');
    const prop = safeExceptionInfo(new TypeError("Cannot read properties of undefined (reading 'title')"));
    expect(prop.message).toBe("Cannot read properties of undefined (reading 'title')");
  });

  it('truncates a very long message', () => {
    const info = safeExceptionInfo(new Error('x'.repeat(500)));
    expect(info.message.length).toBeLessThanOrEqual(200);
  });

  it('keeps only bundle-relative frames with line and column, drops node_modules and node internals', () => {
    const error = new Error('boom');
    error.stack = [
      'Error: boom',
      '    at run (/Users/alice/PostPile/out/main/index.js:42:7)',
      '    at Object.<anonymous> (/Users/alice/PostPile/node_modules/some-lib/index.js:10:2)',
      '    at next (/Users/alice/postpile/node_modules/.pnpm/posthog-node/dist/entry.mjs:5:1)',
      '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n');
    const info = safeExceptionInfo(error);
    expect(info.frames).toEqual([{ file: 'main/index.js', line: 42, column: 7, chunkId: null }]);
  });

  it('takes the path after the last bundle marker, so a folder named out in the home path does not leak', () => {
    const error = new Error('boom');
    error.stack = `Error: boom\n    at run (/Users/alice/out/work/PostPile.app/Contents/Resources/app.asar/out/main/index.js:3:9)`;
    expect(safeExceptionInfo(error).frames[0]?.file).toBe('main/index.js');
  });

  it('is empty when no frame is from the app bundle', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at Object.<anonymous> (/Users/alice/node_modules/some-lib/index.js:10:2)';
    expect(safeExceptionInfo(error).frames).toEqual([]);
  });

  it('never throws for a non-Error value, and gives it no frames', () => {
    expect(safeExceptionInfo('just a string')).toEqual({ type: 'Error', message: 'just a string', frames: [] });
    expect(safeExceptionInfo(42).type).toBe('Error');
  });
});

describe('chunk ids for source maps', () => {
  // The shape posthog-cli's injected snippet leaves: the load-time stack of each bundle file, mapped to its chunk id.
  const chunkIds = {
    [`Error\n    at file://${APP}/renderer/assets/index-B4x_9z.js:1:120`]: '0197e6db-9a73-7b91-9e80-4e1b7158db5c',
    [`Error\n    at ${APP}/main/chunks/engine-from-env-Dk2a.js:1:88\n    at ModuleJob.run (node:internal/modules/esm/module_job:271:25)`]:
      '31339ff4-d09e-5108-a085-f9317673e62b',
  };

  it('puts the chunk id of the frame file on each frame (renderer, file:// URL)', () => {
    const info = scrubException(
      { type: 'TypeError', message: 'boom', stack: `TypeError: boom\n    at Xe (file://${APP}/renderer/assets/index-B4x_9z.js:1:48213)` },
      chunkIds,
    );
    expect(info.frames).toEqual([{ file: 'renderer/assets/index-B4x_9z.js', line: 1, column: 48213, chunkId: '0197e6db-9a73-7b91-9e80-4e1b7158db5c' }]);
  });

  it('matches main process chunks and leaves unknown files without one', () => {
    const error = new Error('boom');
    error.stack = [
      'Error: boom',
      `    at sync (${APP}/main/chunks/engine-from-env-Dk2a.js:35040:12)`,
      `    at start (${APP}/main/index.js:900:3)`,
    ].join('\n');
    const info = safeExceptionInfo(error, chunkIds);
    expect(info.frames.map((frame) => frame.chunkId)).toEqual(['31339ff4-d09e-5108-a085-f9317673e62b', null]);
  });

  it('ignores a chunk id map that is not the injected shape', () => {
    const error = new Error('boom');
    error.stack = `Error: boom\n    at sync (${APP}/main/index.js:1:2)`;
    expect(safeExceptionInfo(error, 'nope').frames[0]?.chunkId).toBeNull();
    expect(safeExceptionInfo(error, { stack: 42 }).frames[0]?.chunkId).toBeNull();
  });

  it('falls back to "Error" for a type that is not a class name', () => {
    expect(scrubException({ type: 'acme/app broke', message: '', stack: null }).type).toBe('Error');
  });
});

describe('rendererExceptionProps', () => {
  const valid = { source: 'window_error', type: 'TypeError', message: 'boom', stack: null, chunk_ids: {} };

  it('takes a renderer error and refuses extra fields or an unknown source', () => {
    expect(rendererExceptionProps.safeParse(valid).success).toBe(true);
    expect(rendererExceptionProps.safeParse({ ...valid, title: 'Fix login' }).success).toBe(false);
    expect(rendererExceptionProps.safeParse({ ...valid, source: 'console' }).success).toBe(false);
  });

  it('caps the stack size', () => {
    expect(rendererExceptionProps.safeParse({ ...valid, stack: 'x'.repeat(20_001) }).success).toBe(false);
  });
});
