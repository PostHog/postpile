import { describe, expect, it } from 'vitest';
import { safeExceptionInfo } from './telemetry-errors.ts';

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

  it('truncates a very long message', () => {
    const info = safeExceptionInfo(new Error('x'.repeat(500)));
    expect(info.message.length).toBeLessThanOrEqual(200);
  });

  it('keeps only bundle-relative stack frames, drops node_modules and node internals', () => {
    const error = new Error('boom');
    error.stack = [
      'Error: boom',
      '    at run (/Users/alice/PostPile/out/main/index.js:42:7)',
      '    at Object.<anonymous> (/Users/alice/PostPile/node_modules/some-lib/index.js:10:2)',
      '    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ].join('\n');
    const info = safeExceptionInfo(error);
    expect(info.stack).toBe('main/index.js:42:7');
  });

  it('is null when no frame is from the app bundle', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at Object.<anonymous> (/Users/alice/node_modules/some-lib/index.js:10:2)';
    expect(safeExceptionInfo(error).stack).toBeNull();
  });

  it('never throws for a non-Error value', () => {
    expect(safeExceptionInfo('just a string').type).toBe('Error');
    expect(safeExceptionInfo(42).type).toBe('Error');
  });
});
