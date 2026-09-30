import { describe, expect, it } from 'vitest';
import type { RendererExceptionProps } from '@postpile/core';
import { ErrorReporter, rendererExceptionReport, watchWindowErrors } from './error-report.ts';

function recorder(chunkIds: unknown = undefined): { reporter: ErrorReporter; sent: RendererExceptionProps[] } {
  const sent: RendererExceptionProps[] = [];
  return { reporter: new ErrorReporter((report) => sent.push(report), () => chunkIds), sent };
}

/** A window stand-in: Node has EventTarget but no ErrorEvent or PromiseRejectionEvent, so the fields are set by hand. */
function fire(target: EventTarget, type: string, fields: Record<string, unknown>): void {
  target.dispatchEvent(Object.assign(new Event(type), fields));
}

describe('rendererExceptionReport', () => {
  it('sends the raw class name, message and stack plus the injected chunk ids', () => {
    const error = new TypeError('boom');
    error.stack = 'TypeError: boom\n    at Xe (file:///app/out/renderer/assets/index-B4x.js:1:4821)';
    const report = rendererExceptionReport(error, 'react_render', { 'Error\n    at file:///app/out/renderer/assets/index-B4x.js:1:1': 'chunk-1' });
    expect(report).toEqual({
      source: 'react_render',
      type: 'TypeError',
      message: 'boom',
      stack: error.stack,
      chunk_ids: { 'Error\n    at file:///app/out/renderer/assets/index-B4x.js:1:1': 'chunk-1' },
    });
  });

  it('turns a thrown string into text with no stack, and ignores a malformed chunk id map', () => {
    expect(rendererExceptionReport('nope', 'unhandled_rejection', 'garbage')).toEqual({
      source: 'unhandled_rejection',
      type: 'Error',
      message: 'nope',
      stack: null,
      chunk_ids: {},
    });
  });

  it('keeps within the server caps', () => {
    const report = rendererExceptionReport(new Error('x'.repeat(9000)), 'window_error', undefined);
    expect(report.message).toHaveLength(5000);
  });
});

describe('watchWindowErrors', () => {
  it('reports an uncaught error and an unhandled rejection from the window', () => {
    const target = new EventTarget();
    const { reporter, sent } = recorder();
    watchWindowErrors(target, reporter);

    fire(target, 'error', { error: new RangeError('bad'), message: 'Uncaught RangeError: bad' });
    fire(target, 'unhandledrejection', { reason: new Error('lost') });
    fire(target, 'error', { error: null, message: 'Script error.' });

    expect(sent.map((report) => [report.source, report.type, report.message])).toEqual([
      ['window_error', 'RangeError', 'bad'],
      ['unhandled_rejection', 'Error', 'lost'],
      ['window_error', 'Error', 'Script error.'],
    ]);
  });

  it('stops after 20 reports per load, so a render loop cannot flood', () => {
    const target = new EventTarget();
    const { reporter, sent } = recorder();
    watchWindowErrors(target, reporter);
    for (let i = 0; i < 30; i += 1) {
      fire(target, 'error', { error: new Error('again'), message: '' });
    }
    expect(sent).toHaveLength(20);
  });

  it('never throws when sending fails', () => {
    const target = new EventTarget();
    const reporter = new ErrorReporter(
      () => {
        throw new Error('server gone');
      },
      () => undefined,
    );
    watchWindowErrors(target, reporter);
    expect(() => reporter.report(new Error('boom'), 'react_render')).not.toThrow();
  });
});
