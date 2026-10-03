import type { IsoTime } from './types.ts';

// The update reminder: the server asks GitHub for the latest PostPile
// releases now and then, and the title bar shows a small pill when one is
// newer than the running app. These are the wire type and the pure rules:
// how two versions compare and which release counts as an update.

/** One release as the update check sees it (from GitHub's releases list). */
export interface ReleaseInfo {
  /** The tag, e.g. "v0.2.0" (the first build was "v0.1.0-alpha.0"). */
  tag: string;
  url: string;
  publishedAt: IsoTime | null;
  /** The release notes (Markdown), '' when there are none. */
  notes: string;
  draft: boolean;
}

/** The fallback when the app cannot update itself. The app is installed as a Homebrew cask. */
export const UPGRADE_COMMAND = 'brew upgrade --cask postpile';

/** How many releases the update check asks GitHub for. A full page may have older releases behind it. */
export const RELEASES_PAGE_SIZE = 10;

/** A release newer than the running app. */
export interface AvailableUpdate {
  /** Without the "v", e.g. "0.2.0". */
  version: string;
  /** The GitHub release page. */
  url: string;
  publishedAt: IsoTime | null;
  notes: string;
  /**
   * When the user first fell behind: the publish time of the oldest release
   * newer than the running app. Not the newest release's time, so a new
   * release does not restart the clock. Null when GitHub gave no time.
   */
  behindSince: IsoTime | null;
  /** Non-draft version releases newer than the running app, among those fetched. */
  releasesBehind: number;
  /** The fetched page was full and ends with a release still newer than the app: the user may be further behind than `releasesBehind` says. */
  moreBehind: boolean;
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
 * The newest release newer than `current`, or null, with how far behind the
 * user is (see AvailableUpdate). Drafts and tags that are not versions are
 * skipped. Pre-releases (with a "-") count too, so a tag like 0.3.0-beta.1
 * still shows; since 0.2.0 releases carry no suffix. Null too when `current`
 * itself is not a version.
 */
export function pickUpdate(current: string, releases: ReleaseInfo[]): AvailableUpdate | null {
  if (!isVersion(current)) {
    return null;
  }
  const versions = releases.filter((release) => !release.draft && isVersion(release.tag));
  const newer = versions.filter((release) => compareVersions(release.tag, current) > 0);
  if (newer.length === 0) {
    return null;
  }
  newer.sort((a, b) => compareVersions(b.tag, a.tag));
  const newest = newer[0]!;
  const oldestMissed = newer[newer.length - 1]!;
  // Only a full page can be cut short: if even its last release is newer, older ones may exist.
  const oldestFetched = versions.reduce((oldest, release) => (compareVersions(release.tag, oldest.tag) < 0 ? release : oldest));
  return {
    version: versionFromTag(newest.tag),
    url: newest.url,
    publishedAt: newest.publishedAt,
    notes: newest.notes,
    behindSince: oldestMissed.publishedAt,
    releasesBehind: newer.length,
    moreBehind: releases.length >= RELEASES_PAGE_SIZE && oldestFetched === oldestMissed,
  };
}

const HOUR_MS = 60 * 60 * 1000;
/** How long the small pill is enough; after this the bar shows. */
export const BAR_AFTER_MS = 24 * HOUR_MS;
/** What "Later" on the bar buys. */
export const BAR_LATER_MS = 24 * HOUR_MS;

export type UpdateUrgency = 'none' | 'pill' | 'bar';

function behindSinceMs(update: AvailableUpdate): number | null {
  if (!update.behindSince) {
    return null;
  }
  const time = Date.parse(update.behindSince);
  return Number.isNaN(time) ? null : time;
}

/** Hours since the user missed their first release, or null when unknown (or nothing to update). */
export function hoursBehind(view: UpdateView, now: number): number | null {
  const since = view.latest ? behindSinceMs(view.latest) : null;
  return since === null ? null : Math.max(0, (now - since) / HOUR_MS);
}

/**
 * How loud the update reminder is. Under 24h behind it is the small pill; from
 * 24h on it is the bar. `snoozedUntil` (epoch ms, from "Later") quiets it:
 * under 24h the pill hides, and from 24h on the bar drops back to the pill.
 * It never goes fully quiet once the user is 24h behind. Without a known
 * time behind, the reminder stays a pill.
 */
export function updateUrgency(view: UpdateView, now: number, snoozedUntil: number | null): UpdateUrgency {
  if (!view.latest) {
    return 'none';
  }
  const snoozed = snoozedUntil !== null && snoozedUntil > now;
  const since = behindSinceMs(view.latest);
  const barDue = since !== null && now - since >= BAR_AFTER_MS;
  if (barDue) {
    return snoozed ? 'pill' : 'bar';
  }
  return snoozed ? 'none' : 'pill';
}

/**
 * Where "Later" snoozes to (epoch ms). On the bar: 24h from now. On the pill:
 * until the bar is due, so the pill hides only until the bar takes over.
 */
export function laterUntil(view: UpdateView, now: number): number {
  const since = view.latest ? behindSinceMs(view.latest) : null;
  if (updateUrgency(view, now, null) === 'pill' && since !== null) {
    return since + BAR_AFTER_MS;
  }
  return now + BAR_LATER_MS;
}

// Self-update: the desktop app downloads a release itself (electron-updater
// in the main process, Squirrel.Mac underneath) and installs it on restart.
// The release check above still decides when the reminder shows and how
// loud it is; the install state only decides what it offers.

/**
 * Where the desktop app's own installer is.
 * - off: not in this build (dev run, web page, POSTPILE_AUTO_UPDATE=0, check off)
 * - idle: checked, nothing to download (or not checked yet)
 * - checking, downloading: on its way
 * - ready: downloaded and staged; a restart installs it, and so does a quit
 * - failed: the last check or download failed (`error` says why)
 */
export type InstallStatus = 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'failed';

/** The main process sends this to the renderer whenever it changes. */
export interface InstallState {
  status: InstallStatus;
  /** The version being downloaded or staged, without the "v"; null when none. */
  version: string | null;
  /** Why the last check or download failed; null otherwise. */
  error: string | null;
}

/**
 * What the update reminder offers: a restart (staged), a "downloading" note,
 * or the brew command. The brew command is the fallback whenever the app
 * cannot update itself: no installer (web, dev, off), a failed download, or
 * an installer that found nothing while the release check did.
 */
export type UpdateAction = 'restart' | 'downloading' | 'command';

export function updateAction(install: InstallState | null): UpdateAction {
  if (!install) {
    return 'command';
  }
  if (install.status === 'ready') {
    return 'restart';
  }
  if (install.status === 'checking' || install.status === 'downloading') {
    return 'downloading';
  }
  return 'command';
}
