import { describe, expect, it } from 'vitest';
import { parseArgs } from './args.ts';

describe('mcp --api', () => {
  it('takes the fake server URL, without a trailing slash', () => {
    expect(parseArgs(['mcp', '--api', 'http://127.0.0.1:4877/'])).toEqual({ name: 'mcp', api: 'http://127.0.0.1:4877' });
  });

  it('shows usage without a URL or with something else', () => {
    expect(parseArgs(['mcp', '--api'])).toEqual({ name: 'help' });
    expect(parseArgs(['mcp', '--api', '4877'])).toEqual({ name: 'help' });
    expect(parseArgs(['mcp', '--api', 'http://127.0.0.1:4877', 'extra'])).toEqual({ name: 'help' });
  });
});
