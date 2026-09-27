import { describe, expect, it } from 'vitest';
import { diffCounts, lineDiff, withContext } from './diff.ts';

describe('lineDiff', () => {
  it('marks added, removed and unchanged lines', () => {
    const before = '# Me\n- CI cost\n- docs\n';
    const after = '# Me\n- CI cost per run\n- docs\n- cache keys\n';
    expect(lineDiff(before, after)).toEqual([
      { kind: 'same', text: '# Me' },
      { kind: 'removed', text: '- CI cost' },
      { kind: 'added', text: '- CI cost per run' },
      { kind: 'same', text: '- docs' },
      { kind: 'added', text: '- cache keys' },
    ]);
  });

  it('handles empty texts and a missing trailing newline', () => {
    expect(lineDiff('', 'a\n')).toEqual([{ kind: 'added', text: 'a' }]);
    expect(lineDiff('a\n', '')).toEqual([{ kind: 'removed', text: 'a' }]);
    expect(lineDiff('a', 'a\n')).toEqual([{ kind: 'same', text: 'a' }]);
  });

  it('counts changes', () => {
    expect(diffCounts(lineDiff('a\nb\n', 'a\nc\nd\n'))).toBe('+2 −1');
  });
});

describe('withContext', () => {
  it('collapses unchanged runs away from the changes', () => {
    const lines = lineDiff('1\n2\n3\n4\n5\n6\n', '1\n2\n3\n4\n5\n6\n7\n');
    expect(withContext(lines, 1)).toEqual([
      { kind: 'gap', count: 5 },
      { kind: 'same', text: '6' },
      { kind: 'added', text: '7' },
    ]);
  });
});
