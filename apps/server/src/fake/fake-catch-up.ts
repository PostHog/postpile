import { isTracked, type ActionResult, type CatchUpRunState, type FullPr, type Glance, type GlanceGap, type PrKey } from '@postpile/core';
import type { SampleData } from './sample-data.ts';

export interface FakeCatchUpOptions {
  /** How long a fake run waits in the queue before it "writes". Tests pass 0. */
  queuedMs: number;
  /** How long the fake writing takes. Tests pass 0. */
  writingMs: number;
}

type Phase = 'queued' | 'writing';

type GlanceText = Pick<Glance, 'verdict' | 'forYou' | 'does' | 'risk' | 'othersSaid'>;

/**
 * What the catch-up writes for the sample PRs it catches up (#1945 queued at
 * start, #1808 on Retry), worded like a real glance so testers read it as one.
 */
const CATCH_UP_TEXT: Record<number, GlanceText> = {
  1945: {
    verdict: 'LOOKS_SAFE',
    forYou: 'Your draft. remy asks whether 3 retries would hide fewer real flakes.',
    does: 'Caps CI shard retries at 2, so a flaky shard fails sooner.',
    risk: 'Low. A real flake fails the run one retry earlier.',
    othersSaid: 'remy asked about 3 retries. lyra has not reviewed yet.',
  },
  1808: {
    verdict: 'LOOK_CLOSER',
    forYou: 'Your PR. Only the review bot approved it, so a person still has to look.',
    does: 'Drops the old billing re-exports that #1801 left behind.',
    risk: 'Medium. Any import of the old path breaks at startup.',
    othersSaid: 'reviewbot approved.',
  },
};

/** Any other PR the fake rewrites (a stale glance looked at): plain facts from the PR. */
function genericText(pr: FullPr | undefined): GlanceText {
  const reviews = pr?.reviews.length ?? 0;
  return {
    verdict: 'LOOKS_SAFE',
    forYou: 'Nothing in the newest activity changes what this asks of you.',
    does: pr ? `${pr.title}.` : 'A small change.',
    risk: 'Low.',
    othersSaid: reviews === 0 ? 'No reviews yet.' : reviews === 1 ? 'One review so far.' : `${reviews} reviews so far.`,
  };
}

/**
 * Stand-in for the glance catch-up on the sample data, so the UI states can
 * be checked: once a UI watches (the first live status read), one PR without
 * a glance goes queued -> writing -> ready over a few seconds, and another one reads as failed, so Retry can be
 * tried (it walks the same way). A stale sample glance looked at goes
 * writing -> ready (refresh on look). No agent; the glance is canned.
 */
export class FakeCatchUp {
  private readonly phases = new Map<PrKey, Phase>();
  private readonly failed = new Set<PrKey>();
  /** PRs whose glance this fake wrote: a stale sample glance is current after its refresh. */
  private readonly written = new Set<PrKey>();
  /** Writing for a refresh on look: a glance-only run, no memory rewritten. */
  private readonly glanceOnly = new Set<PrKey>();
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
    const text = (pr ? CATCH_UP_TEXT[pr.ref.number] : undefined) ?? genericText(pr);
    return {
      prKey,
      ...text,
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

  /** Writing for writingMs, then the canned glance replaces whatever the PR had. */
  private write(prKey: PrKey): void {
    this.phases.set(prKey, 'writing');
    this.changeCount += 1;
    this.after(this.options.writingMs, () => {
      const others = this.data.glances.filter((glance) => glance.prKey !== prKey);
      this.data.glances.splice(0, this.data.glances.length, ...others, this.cannedGlance(prKey));
      this.written.add(prKey);
      this.glanceOnly.delete(prKey);
      this.phases.delete(prKey);
      this.changeCount += 1;
    });
  }

  private run(prKey: PrKey): void {
    this.failed.delete(prKey);
    this.phases.set(prKey, 'queued');
    this.changeCount += 1;
    this.after(this.options.queuedMs, () => this.write(prKey));
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

  /** A stale glance looked at: rewritten right away, unless a run for the PR is going. */
  refreshOnLook(prKey: PrKey): 'started' | 'covered' {
    if (this.phases.has(prKey)) {
      return 'covered';
    }
    this.glanceOnly.add(prKey);
    this.write(prKey);
    return 'started';
  }

  /** One of these PRs is being written by a stand-in whole-topic run (not a refresh on look): its memory counts as updating. */
  memoryUpdating(prKeys: PrKey[]): boolean {
    return prKeys.some((key) => this.phases.get(key) === 'writing' && !this.glanceOnly.has(key));
  }

  /** The PR's glance was written by this fake, so it is current. */
  wrote(prKey: PrKey): boolean {
    return this.written.has(prKey);
  }

  changes(): number {
    return this.changeCount;
  }
}
