import { parseScouts, type ScoutConfig, type ScoutsVersion } from '@postpile/core';
import type { Store } from '@postpile/store';
import { readInstructions } from '../instructions/file.ts';

/** scouts.md versions are short; this many are enough to find the last one that parsed. */
const VALID_VERSION_LOOKBACK = 100;

export interface CurrentScoutsText {
  text: string;
  /** Null only while no text was ever seen. */
  version: ScoutsVersion | null;
}

/** The scouts in force (DESIGN.md "Scouts" › Config). */
export interface ActiveScouts {
  /** The file's scouts when it parses; else the last stored version that did; else none. */
  scouts: ScoutConfig[];
  /** The version they come from. Null when no text that parses was ever seen. */
  version: ScoutsVersion | null;
  /** Problems in the file on disk, "line 4: …". While any are left, `scouts` are the last valid version's. */
  errors: string[];
}

/**
 * scouts.md plus its stored versions, like InstructionsHistory: the file
 * stays the source of truth and the user may edit it by hand at any time,
 * so every read first stores a text that differs from the newest version.
 * An edit that does not parse is stored too (nothing the user wrote is
 * lost), but the last version that parsed stays in force until it is
 * fixed, and the errors say why.
 *
 * Read-only (the MCP process) never stores anything.
 */
export class ScoutsHistory {
  constructor(
    private readonly store: Store,
    readonly file: string,
    private readonly now: () => Date,
    private readonly readOnly = false,
  ) {}

  current(): CurrentScoutsText {
    // A missing file means no scouts, the same as for instructions.md.
    const text = readInstructions(this.file);
    const latest = this.store.scoutsVersions.latest();
    if (latest !== null && latest.text === text) {
      return { text, version: latest };
    }
    if (this.readOnly) {
      return { text, version: latest };
    }
    if (latest === null && text.trim() === '') {
      return { text, version: null };
    }
    const version = this.store.scoutsVersions.add({
      text,
      summary: latest === null ? 'Found on disk' : 'Edited outside the app',
      origin: 'outside',
      createdAt: this.now().toISOString(),
    });
    return { text, version };
  }

  active(): ActiveScouts {
    const { text, version } = this.current();
    const parsed = parseScouts(text);
    if (parsed.errors.length === 0) {
      return { scouts: parsed.scouts, version, errors: [] };
    }
    for (const older of this.store.scoutsVersions.list(VALID_VERSION_LOOKBACK)) {
      const olderParse = parseScouts(older.text);
      if (olderParse.errors.length === 0) {
        return { scouts: olderParse.scouts, version: older, errors: parsed.errors };
      }
    }
    return { scouts: [], version: null, errors: parsed.errors };
  }
}
