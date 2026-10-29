import { appendScout, parseScouts, type ScoutConfig, type ScoutsVersion, type ScoutTurnOnRequest } from '@postpile/core';
import type { Store } from '@postpile/store';
import { readInstructions, writeInstructionsAtomically } from '../instructions/file.ts';

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

  /**
   * The intro card's "Turn on scout": the scout appended to scouts.md and
   * the text recorded as a version of origin `intro`. Whatever is on disk is
   * recorded first (`current`), so a hand edit made meanwhile stays its own
   * version. Refused when the file or the new scout would not parse.
   */
  appendScout(scout: ScoutTurnOnRequest): { version: ScoutsVersion } | { error: string } {
    if (this.readOnly) {
      return { error: 'read-only: scouts.md is not written from here' };
    }
    const { text } = this.current();
    const next = appendScout(text, scout);
    if ('error' in next) {
      return next;
    }
    writeInstructionsAtomically(this.file, next.text);
    const version = this.store.scoutsVersions.add({ text: next.text, summary: `Turned on ${scout.name} from the intro card`, origin: 'intro', createdAt: this.now().toISOString() });
    return { version };
  }

  active(): ActiveScouts {
    const { text, version } = this.current();
    const parsed = parseScouts(text);
    if (parsed.errors.length === 0) {
      return { scouts: parsed.scouts, version, errors: [] };
    }
    // Every stored version, however many broken edits came after the last valid one: the texts are short and few.
    for (const older of this.store.scoutsVersions.listAll()) {
      const olderParse = parseScouts(older.text);
      if (olderParse.errors.length === 0) {
        return { scouts: olderParse.scouts, version: older, errors: parsed.errors };
      }
    }
    return { scouts: [], version: null, errors: parsed.errors };
  }
}
