// CODEOWNERS-style glob matching without a regex (DESIGN.md "Scouts" ›
// paths). Scout path hints can come from the model, and a compiled regex
// such as `a[^/]*a[^/]*…b` backtracks for seconds on a long name. These
// loops never backtrack beyond the last `*` of one segment, so a match
// costs at most pattern length times path length.

/**
 * One path segment against one name segment: `*` is any run of characters,
 * `?` one character, everything else itself. The classic greedy match: on a
 * mismatch it only goes back to the last `*`, never further.
 */
export function segmentMatches(pattern: string, name: string): boolean {
  let p = 0;
  let n = 0;
  let star = -1;
  let starAt = 0;
  while (n < name.length) {
    // A "*" is always a wildcard, also against a "*" in the name.
    if (p < pattern.length && pattern[p] === '*') {
      star = p;
      starAt = n;
      p += 1;
    } else if (p < pattern.length && (pattern[p] === '?' || pattern[p] === name[n])) {
      p += 1;
      n += 1;
    } else if (star >= 0) {
      p = star + 1;
      starAt += 1;
      n = starAt;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') {
    p += 1;
  }
  return p === pattern.length;
}

function hasWildcard(segment: string): boolean {
  return segment.includes('*') || segment.includes('?');
}

/**
 * The pattern over a repo path ("src/app.ts", no leading slash), with the
 * same rules as `codeownersPatternRegex`: a pattern without "/" matches at
 * any depth, `**` spans any number of folders, a trailing "/" only matches
 * inside that folder, and a pattern that names a file or folder also covers
 * everything under it, except when its last segment has a wildcard.
 * Segment by segment with a memo over (pattern segment, path segment), and
 * each state does constant work besides one segment match: a `**` either
 * stops or takes one more folder and stays.
 */
export function globPathMatches(pattern: string, path: string): boolean {
  const dirOnly = pattern.endsWith('/');
  let body = dirOnly ? pattern.slice(0, -1) : pattern;
  const anchored = body.includes('/');
  if (body.startsWith('/')) {
    body = body.slice(1);
  }
  if (body === '') {
    return false;
  }
  const globs = body.split('/');
  const names = path.split('/');
  const last = globs[globs.length - 1]!;
  const exactEnd = !dirOnly && (last === '**' || hasWildcard(last));
  const memo = new Map<number, boolean>();

  // Whether globs[g..] match names[n..], then what may follow the match.
  const from = (g: number, n: number): boolean => {
    const key = g * (names.length + 1) + n;
    const known = memo.get(key);
    if (known !== undefined) {
      return known;
    }
    let result: boolean;
    if (g === globs.length) {
      const rest = names.length - n;
      result = dirOnly ? rest >= 1 : exactEnd ? rest === 0 : true;
    } else if (globs[g] === '**' && g === globs.length - 1) {
      // Last: everything below, one segment at least.
      result = n < names.length;
    } else if (globs[g] === '**') {
      // Zero folders here, or take one and stay on the `**`.
      result = from(g + 1, n) || (n < names.length && from(g, n + 1));
    } else {
      result = n < names.length && segmentMatches(globs[g]!, names[n]!) && from(g + 1, n + 1);
    }
    memo.set(key, result);
    return result;
  };

  if (anchored) {
    return from(0, 0);
  }
  for (let start = 0; start < names.length; start++) {
    if (from(0, start)) {
      return true;
    }
  }
  return false;
}
