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
 * Segment by segment over a table of (pattern segment, path segment),
 * filled bottom-up without recursion, so neither time nor stack grows with
 * the number of globstars beyond that table: a `**` either stops or takes
 * one more folder and stays.
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
  const width = names.length + 1;
  // Bottom-up, one pattern segment at a time, no recursion: `row[n]` says
  // whether globs[g..] match names[n..], then what may follow the match.
  let row = Array.from({ length: width }, (_, n) => {
    const rest = names.length - n;
    return dirOnly ? rest >= 1 : exactEnd ? rest === 0 : true;
  });
  for (let g = globs.length - 1; g >= 0; g--) {
    const glob = globs[g]!;
    const after = row;
    row = Array.from({ length: width }, () => false);
    for (let n = names.length; n >= 0; n--) {
      if (glob === '**' && g === globs.length - 1) {
        // Last: everything below, one segment at least; "**/" only inside a folder there, so two.
        row[n] = names.length - n >= (dirOnly ? 2 : 1);
      } else if (glob === '**') {
        // Zero folders here, or take one and stay on the `**`.
        row[n] = after[n]! || (n < names.length && row[n + 1]!);
      } else {
        row[n] = n < names.length && after[n + 1]! && segmentMatches(glob, names[n]!);
      }
    }
  }
  // Anchored at the root; else from any folder down.
  return anchored ? row[0]! : row.slice(0, names.length).some(Boolean);
}
