import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeThreadFor } from '@postpile/core/fixtures';
import { Store } from '@postpile/store';
import { afterEach, describe, expect, it } from 'vitest';
import { InstructionsHistory } from './instructions/history.ts';
import { makeHarness } from './testing/fakes.ts';
import { reviewRequestedPr } from './testing/prs.ts';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'postpile-ro-instructions-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const BASE = '# Me\n- I care about CI cost.\n';
const EDITED = '# Me\n- I care about CI cost.\n- Flag cache key changes.\n';

describe('instructions in a read-only process', () => {
  it('reads an edited file without storing a version', () => {
    const dir = tempDir();
    const databaseFile = join(dir, 'db.sqlite');
    const file = join(dir, 'instructions.md');
    writeFileSync(file, BASE);
    const writer = Store.open(databaseFile);
    const recorded = new InstructionsHistory(writer, file, () => new Date()).current().version;
    writer.close();
    writeFileSync(file, EDITED);

    const store = Store.openReadOnly(databaseFile);
    const current = new InstructionsHistory(store, file, () => new Date(), true).current();

    expect(current.text).toBe(EDITED);
    expect(current.version?.version).toBe(recorded?.version);
    expect(store.instructions.latest()?.text).toBe(BASE);
    store.close();
  });

  it('shows a glance made before the edit as stale instead of throwing', async () => {
    const dir = tempDir();
    const databaseFile = join(dir, 'db.sqlite');
    const file = join(dir, 'instructions.md');
    writeFileSync(file, BASE);
    const pr = reviewRequestedPr(1);
    const app = makeHarness({ store: Store.open(databaseFile), instructionsFile: file });
    app.reader.addPr(pr, makeThreadFor(pr));
    await app.engine.sync({ agentJobs: ['glances'] });
    expect((await app.engine.getPr(pr.key))?.glanceStale).toBe(false);
    app.store.close();
    writeFileSync(file, EDITED);

    const store = Store.openReadOnly(databaseFile);
    const mcp = makeHarness({ store, instructionsFile: file, storeReadOnly: true, writesEnabled: false });
    const detail = await mcp.engine.getPr(pr.key);

    expect(detail?.glance).not.toBeNull();
    expect(detail?.glanceStale).toBe(true);
    expect(store.instructions.latest()?.text).toBe(BASE);
    store.close();
  });
});
