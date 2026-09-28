import type { InstructionsVersion } from '@postpile/core';
import type { Store } from '@postpile/store';
import { readInstructions, writeInstructionsAtomically } from './file.ts';

export interface CurrentInstructions {
  text: string;
  /** Null only while no text was ever seen. */
  version: InstructionsVersion | null;
}

/**
 * instructions.md plus its stored versions. The file stays the source of
 * truth and the user may edit it by hand at any time, so every read first
 * stores a text that differs from the newest version as "edited outside
 * the app". Nothing the user wrote is ever lost to a later save.
 */
export class InstructionsHistory {
  constructor(
    private readonly store: Store,
    readonly file: string,
    private readonly now: () => Date,
  ) {}

  current(): CurrentInstructions {
    const text = readInstructions(this.file);
    const latest = this.store.instructions.latest();
    if (latest !== null && latest.text === text) {
      return { text, version: latest };
    }
    if (latest === null && text.trim() === '') {
      return { text, version: null };
    }
    const version = this.store.instructions.add({
      text,
      summary: latest === null ? 'Found on disk' : 'Edited outside the app',
      origin: 'outside',
      sourceChatMessageId: null,
      createdAt: this.now().toISOString(),
    });
    return { text, version };
  }

  /** Writes the file and stores the version. The caller has checked that nothing changed on disk since the proposal. */
  save(text: string, summary: string, sourceChatMessageId: number): InstructionsVersion {
    writeInstructionsAtomically(this.file, text);
    return this.store.instructions.add({ text, summary, origin: 'chat', sourceChatMessageId, createdAt: this.now().toISOString() });
  }

  /** Writes the file and stores a setup version. The caller has checked the version the draft was reviewed against. */
  saveFromSetup(text: string, summary: string): InstructionsVersion {
    writeInstructionsAtomically(this.file, text);
    return this.store.instructions.add({ text, summary, origin: 'setup', sourceChatMessageId: null, createdAt: this.now().toISOString() });
  }
}
