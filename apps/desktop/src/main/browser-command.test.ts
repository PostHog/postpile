import { describe, expect, it } from 'vitest';
import { appBundleOf, browserCommand, browserUrl } from './browser-command.ts';

describe('postpile browser arguments', () => {
  it('runs in the foreground without arguments and maps each flag', () => {
    expect(browserCommand([])).toEqual({ kind: 'run' });
    expect(browserCommand(['--at-login'])).toEqual({ kind: 'at-login' });
    expect(browserCommand(['--stop'])).toEqual({ kind: 'stop' });
    expect(browserCommand(['--restart'])).toEqual({ kind: 'restart' });
    expect(browserCommand(['-h'])).toEqual({ kind: 'help' });
  });

  it('refuses unknown or combined arguments', () => {
    expect(browserCommand(['--daemon'])).toEqual({ kind: 'error', message: 'Unknown arguments: --daemon' });
    expect(browserCommand(['--stop', '--restart']).kind).toBe('error');
  });

  it('finds the app bundle from the binary it runs on, and nothing for a plain node', () => {
    expect(appBundleOf('/Applications/PostPile.app/Contents/MacOS/PostPile')).toBe('/Applications/PostPile.app');
    expect(appBundleOf('/opt/homebrew/bin/node')).toBeNull();
  });

  it('points at postpile.localhost on the server port', () => {
    expect(browserUrl(undefined)).toBe('http://postpile.localhost:4870');
    expect(browserUrl('4900')).toBe('http://postpile.localhost:4900');
  });
});
