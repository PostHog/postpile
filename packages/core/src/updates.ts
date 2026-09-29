import type { IsoTime } from './types.ts';

// The update reminder: the server asks GitHub for the latest PostPile
// releases now and then, and the title bar shows a small pill when one is
// newer than the running app. These are the wire type and the pure rules:
// how two versions compare and which release counts as an update.

/** One release as the update check sees it (from GitHub's releases list). */
export interface ReleaseInfo {
  /** The tag, e.g. "v0.1.0-alpha.1". */
  tag: string;
  url: string;
  publishedAt: IsoTime | null;
  /** The release notes (Markdown), '' when there are none. */
  notes: string;
  draft: boolean;
}

/** A release newer than the running app. */
export interface AvailableUpdate {
  /** Without the "v", e.g. "0.1.0-alpha.1". */
  version: string;
  /** The GitHub release page. */
  url: string;
  publishedAt: IsoTime | null;
  notes: string;
}

/** GET /api/update. */
export interface UpdateView {
  /** The running app's version. */
  current: string;
  /** Null when the app is up to date, not checked yet, or the check is off. */
  latest: AvailableUpdate | null;
  checkedAt: IsoTime | null;
  /** Why the last check failed; null when it worked (or never ran). */
  error: string | null;
}

interface ParsedVersion {
  core: [number, number, number];
  /** "alpha.1" -> ["alpha", "1"]; empty for a release. */
  pre: string[];
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** "v0.1.0-alpha.1" or "0.1.0". Null for anything that is not semver. */
function parseVersion(text: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(text.trim());
  if (!match) {
    return null;
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.') : [],
  };
}

export function isVersion(text: string): boolean {
  return parseVersion(text) !== null;
}

/** "v0.1.0-alpha.1" -> "0.1.0-alpha.1". */
export function versionFromTag(tag: string): string {
  return tag.trim().replace(/^v/, '');
}

/** Semver order of one pre-release part: numbers compare as numbers and sort before words. */
function comparePreParts(a: string, b: string): number {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) {
    return Number(a) - Number(b);
  }
  if (aNumeric) {
    return -1;
  }
  if (bNumeric) {
    return 1;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** A release sorts after its own pre-releases; otherwise part by part, and a longer list wins a tie. */
function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) {
    return b.length - a.length;
  }
  const shared = Math.min(a.length, b.length);
  for (let index = 0; index < shared; index++) {
    const result = comparePreParts(a[index] ?? '', b[index] ?? '');
    if (result !== 0) {
      return result;
    }
  }
  return a.length - b.length;
}

/**
 * Semver order with pre-release tags: 0.1.0-alpha.0 < 0.1.0-alpha.1 <
 * 0.1.0-beta.0 < 0.1.0. A leading "v" and build metadata are ignored.
 * Negative when a is older, positive when newer, 0 when the same. Throws on
 * text that is not a version; check with isVersion first.
 */
export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    throw new Error(`not a version: ${left ? b : a}`);
  }
  for (let index = 0; index < 3; index++) {
    const result = left.core[index]! - right.core[index]!;
    if (result !== 0) {
      return Math.sign(result);
    }
  }
  return Math.sign(comparePre(left.pre, right.pre));
}

/**
 * The newest release newer than `current`, or null. Drafts and tags that are
 * not versions are skipped. Pre-releases count: every release is an alpha
 * for now. Null too when `current` itself is not a version.
 */
export function pickUpdate(current: string, releases: ReleaseInfo[]): AvailableUpdate | null {
  if (!isVersion(current)) {
    return null;
  }
  let best: ReleaseInfo | null = null;
  for (const release of releases) {
    if (release.draft || !isVersion(release.tag)) {
      continue;
    }
    if (compareVersions(release.tag, current) <= 0) {
      continue;
    }
    if (best === null || compareVersions(release.tag, best.tag) > 0) {
      best = release;
    }
  }
  if (!best) {
    return null;
  }
  return { version: versionFromTag(best.tag), url: best.url, publishedAt: best.publishedAt, notes: best.notes };
}
