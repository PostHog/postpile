import { isTracked, type ActionResult, type CatchUpRunState, type Glance, type GlanceGap, type PrKey } from '@postpile/core';
import type { SampleData } from './sample-data.ts';

export interface FakeCatchUpOptions {
  /** How long a fake run waits in the queue before it "writes". Tests pass 0. */
  queuedMs: number;
  /** How long the fake writing takes. Tests pass 0. */
  writingMs: number;
}

type Phase = 'queued' | 'writing';

/**
 * Stand-in for the glance catch-up on the sample data, so the UI states can
 * be checked: once a UI watches (the first live status read), one PR without
 * a glance goes queued -> writing -> ready over a few seconds, and another one reads as failed, so Retry can be
 * tried (it walks the same way). No agent; the glance is canned.
 */
export class FakeCatchUp {
  private readonly phases = new Map<PrKey, Phase>();
  private readonly failed = new Set<PrKey>();
  private changeCount = 0;
  private seeded = false;

  constructor(
    private readonly data: SampleData,
    private readonly now: () => Date,
    private readonly options: FakeCatchUpOptions,
  ) {}

  /** Open pinged or found sample PRs without a glance, in sample order. */
  private missing(): PrKey[] {
    const keys = new Set<PrKey>();
    for (const member of this.data.tiles.flatMap((tile) => tile.members)) {
      const pr = this.data.prs.find((candidate) => candidate.key === member.prKey);
      if (pr?.state === 'OPEN' && isTracked(member.provenance) && !this.hasGlance(pr.key)) {
        keys.add(pr.key);
      }
    }
    return [...keys];
  }

  private hasGlance(prKey: PrKey): boolean {
    return this.data.glances.some((glance) => glance.prKey === prKey);
  }

  private cannedGlance(prKey: PrKey): Glance {
    const pr = this.data.prs.find((candidate) => candidate.key === prKey);
    return {
      prKey,
      verdict: 'LOOKS_SAFE',
      forYou: 'Written by the sample catch-up a few seconds after start.',
      does: pr ? `Does what the title says: ${pr.title}.` : 'Small change.',
      risk: 'Low.',
      othersSaid: 'No comments yet.',
      keyFiles: [],
      pullInReason: null,
      dossierVersion: null,
      inputHash: `sample-catch-up-${prKey}`,
      model: 'sample',
      createdAt: this.now().toISOString(),
    };
  }

  private after(ms: number, step: () => void): void {
    setTimeout(step, ms);
  }

  private run(prKey: PrKey): void {
    this.failed.delete(prKey);
    this.phases.set(prKey, 'queued');
    this.changeCount += 1;
    this.after(this.options.queuedMs, () => {
      this.phases.set(prKey, 'writing');
      this.changeCount += 1;
      this.after(this.options.writingMs, () => {
        this.data.glances.push(this.cannedGlance(prKey));
        this.phases.delete(prKey);
        this.changeCount += 1;
      });
    });
  }

  /** Once: the first PR without a glance catches up, the second one reads as failed. */
  seedOnce(): void {
    if (this.seeded) {
      return;
    }
    this.seeded = true;
    const [first, second] = this.missing();
    if (first) {
      this.run(first);
    }
    if (second) {
      this.failed.add(second);
    }
  }

  stateOf(prKey: PrKey): CatchUpRunState {
    const phase = this.phases.get(prKey);
    if (phase === 'writing') {
      return 'running';
    }
    return phase === 'queued' ? 'queued' : null;
  }

  /** Failed for the seeded one; the other PRs without a glance read as skipped by the call cap. */
  gapOf(prKey: PrKey): GlanceGap | null {
    if (this.hasGlance(prKey)) {
      return null;
    }
    const at = this.now().toISOString();
    if (this.failed.has(prKey)) {
      return { reason: 'failed', detail: 'left out of the answer', at };
    }
    return { reason: 'call_cap', detail: 'The sync stopped at its agent-call cap before this PR.', at };
  }

  retry(prKey: PrKey): ActionResult {
    if (this.hasGlance(prKey)) {
      return { ok: true, message: 'This PR already has a glance.', undoToken: null };
    }
    if (this.phases.has(prKey)) {
      return { ok: true, message: 'Glance queued: its topic is being caught up, one more run follows.', undoToken: null };
    }
    this.run(prKey);
    return { ok: true, message: 'Writing the glance…', undoToken: null };
  }

  changes(): number {
    return this.changeCount;
  }
}
