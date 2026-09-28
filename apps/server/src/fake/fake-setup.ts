import {
  changedHeadings,
  claimKey,
  formatInstructionsSections,
  mapSetupDraft,
  rankActivityRepos,
  setupSources,
  userWrittenLines,
  type ActionResult,
  type ActivityPr,
  type SetupAcceptRequest,
  type SetupAcceptResult,
  type SetupChecksView,
  type SetupDraft,
  type SetupDraftAnswer,
  type SetupMaterial,
  type SetupRefineRequest,
  type SetupRefineResult,
  type SetupStatus,
  type SetupSweepLine,
  type SetupSweepView,
  type Viewer,
} from '@postpile/core';
import type { FakeInstructions } from './fake-instructions.ts';

function samplePr(repo: string, number: number, role: ActivityPr['role'], title: string, dirs: string[], state: ActivityPr['state'] = 'MERGED'): ActivityPr {
  return {
    key: `${repo}#${number}`,
    repo,
    number,
    title,
    url: `https://github.com/${repo}/pull/${number}`,
    role,
    state,
    updatedAt: '2026-09-20T10:00:00.000Z',
    dirs,
  };
}

/** Invented activity for the sample viewer: CI work in the main repo, a few drive-by reviews elsewhere. */
const SAMPLE_ACTIVITY: ActivityPr[] = [
  samplePr('PostHog/posthog', 41850, 'authored', 'Run backend tests on Depot runners', ['.github/', 'bin/']),
  samplePr('PostHog/posthog', 41862, 'authored', 'Turbo remote cache for the frontend build', ['.github/', 'frontend/'], 'OPEN'),
  samplePr('PostHog/posthog', 41871, 'authored', 'Split the backend suite into even shards', ['.github/', 'posthog/']),
  samplePr('PostHog/posthog', 41903, 'review_requested', 'Playwright shards on Depot', ['.github/', 'playwright/'], 'OPEN'),
  samplePr('PostHog/posthog', 41790, 'reviewed', 'Bump the Node version in CI', ['.github/']),
  samplePr('PostHog/posthog', 41802, 'reviewed', 'Cache pnpm store between jobs', ['.github/']),
  samplePr('PostHog/example-infra', 41915, 'reviewed', 'DEPOT_TOKEN as repo secret', ['terraform/']),
  samplePr('PostHog/example-infra', 41918, 'reviewed', 'Runner pool sizing', ['terraform/']),
  samplePr('PostHog/posthog-python', 41925, 'reviewed', 'Release workflow cleanup', ['.github/']),
  samplePr('PostHog/posthog-desktop', 41940, 'reviewed', 'Fix a typo in the README', ['(root)']),
];

const SAMPLE_CODEOWNERS = [
  { repo: 'PostHog/posthog', path: '.github/CODEOWNERS', lines: ['/.github/workflows/ @PostHog/team-devex', '/bin/ci/ @PostHog/team-devex'] },
  { repo: 'PostHog/example-infra', path: 'CODEOWNERS', lines: ['/terraform/runners/ @PostHog/team-devex'] },
];

const SAMPLE_DIGEST = {
  version: 3,
  createdAt: '2026-09-27T09:00:00.000Z',
  text: 'Moving the monorepo CI to Depot is the main thread; Turbo caching and e2e are next. Shard splitting for the test suite is being reworked alongside.',
};

/** Canned stand-in for the setup_draft answer; source ids follow setupSources' order (t1, p1-p10, o1-o2, d1). */
const SAMPLE_ANSWER: SetupDraftAnswer = {
  summary: 'Based on 10 PRs of the last 30 days, CODEOWNERS in two repos and your work context digest.',
  sections: [
    {
      heading: 'About me',
      claims: [
        { text: 'I work on developer experience on PostHog/team-devex: CI, build tooling, local dev.', sources: ['t1', 'p1', 'p3'] },
        { text: 'Right now I am moving the monorepo CI to Depot.', sources: ['d1', 'p1'] },
      ],
    },
    {
      heading: 'What I own',
      claims: [
        { text: 'GitHub workflows and CI scripts in PostHog/posthog (.github/workflows/, bin/ci/).', sources: ['o1', 'p1', 'p3'] },
        { text: 'Runner config in PostHog/example-infra (terraform/runners/).', sources: ['o2', 'p8'] },
        { text: 'The Turbo cache and test sharding setup.', sources: ['p2', 'p3', 'd1'] },
      ],
    },
    {
      heading: 'What gets routed to me',
      claims: [
        { text: 'Reviews for team-devex on CI and workflow changes; I look at cost, cache keys and flakiness.', sources: ['p4', 'p5', 'p6'] },
        { text: 'Infra PRs that touch runners or CI secrets.', sources: ['p7', 'p8'] },
      ],
    },
    {
      heading: 'What to ignore or keep quiet',
      claims: [
        { text: 'Docs and README-only PRs in other repos.', sources: ['p10'] },
        { text: 'Dependency bumps, unless they touch CI config.', sources: [] },
      ],
    },
    {
      heading: 'Preferences',
      claims: [{ text: 'Short summaries; tell me what needs me first.', sources: [] }],
    },
  ],
  quietRepos: [
    { repo: 'PostHog/posthog-desktop', why: 'One README review, nothing you own.', sources: ['p10'] },
    { repo: 'PostHog/posthog-python', why: 'A single drive-by review of a release workflow.', sources: ['p9'] },
  ],
  mainRepo: { repo: 'PostHog/posthog', why: 'All your own PRs and most reviews are here.', sources: ['p1', 'p2', 'p3'] },
};

interface FakeLine {
  step: SetupSweepLine['step'];
  running: string;
  done: string;
  state: SetupSweepLine['state'];
}

const SWEEP_SCRIPT: FakeLine[] = [
  { step: 'viewer', running: 'Reading your GitHub profile and teams…', done: 'Signed in as @you · teams PostHog/team-devex · 4 teammates', state: 'done' },
  {
    step: 'activity',
    running: 'Searching your PRs of the last 30 days…',
    done: 'Found 10 PRs in 30 days: 3 you wrote, 6 you reviewed, 1 waiting on your review · 4 repos',
    state: 'done',
  },
  {
    step: 'codeowners',
    running: 'Reading CODEOWNERS in PostHog/posthog, PostHog/example-infra, PostHog/posthog-python, PostHog/posthog-desktop…',
    done: 'CODEOWNERS: 3 lines name you or your teams (PostHog/posthog, PostHog/example-infra)',
    state: 'done',
  },
  { step: 'digest', running: 'Looking for your work context digest…', done: 'Using your work context digest v3 (2026-09-27)', state: 'done' },
  { step: 'draft', running: 'Asking the agent for a draft (opus)…', done: 'Draft ready: 5 sections, 2 quiet repo suggestions', state: 'done' },
];

/** How long each sweep line "works", relative to the step delay: the draft takes longest. */
const STEP_WEIGHTS = [1, 2, 1.5, 0.5, 4];

export interface FakeSetupDeps {
  instructions: FakeInstructions;
  viewer: () => Viewer;
  setQuiet: (repo: string) => void;
  setScope: (repo: string | null) => void;
  now: () => Date;
  /** POSTPILE_FAKE_SETUP=1: the flow shows on start until accepted or skipped. */
  forced: boolean;
  /** Base delay of the canned checks, sweep lines and refine. Tests pass 0. */
  stepMs: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The setup flow for FakeEngine: canned checks, a sweep that walks its
 * lines after short delays, a canned draft built with the real rules
 * (setupSources, mapSetupDraft), a refine that files the user's point
 * under Preferences, and an accept that writes to the in-memory
 * instructions. Nothing touches GitHub, the agent or the disk.
 */
export class FakeSetup {
  private flag: { flag: 'done' | 'skipped'; at: string } | null = null;
  private sweep: { startedAt: string; finishedAt: string | null; lines: SetupSweepLine[]; draft: SetupDraft | null } | null = null;
  private running: Promise<void> | null = null;
  private readonly material: SetupMaterial;

  constructor(private readonly deps: FakeSetupDeps) {
    this.material = { viewer: deps.viewer(), since: '2026-08-29T00:00:00.000Z', prs: SAMPLE_ACTIVITY, codeowners: SAMPLE_CODEOWNERS, digest: SAMPLE_DIGEST };
  }

  status(): SetupStatus {
    const hasInstructions = this.deps.instructions.view().text.trim() !== '';
    return {
      needed: this.flag === null && (this.deps.forced || !hasInstructions),
      flag: this.flag?.flag ?? null,
      flaggedAt: this.flag?.at ?? null,
      hasInstructions,
    };
  }

  async checks(): Promise<SetupChecksView> {
    await delay(this.deps.stepMs);
    return {
      checks: [
        { id: 'gh', label: 'GitHub CLI (gh) installed', state: 'ok', detail: 'gh version 2.60.0 (sample data)', fix: null },
        { id: 'gh_auth', label: 'Logged in to GitHub', state: 'ok', detail: 'Logged in as @you · 1 team', fix: null },
        { id: 'notifications', label: 'GitHub notifications readable', state: 'ok', detail: 'The token can read your notifications inbox.', fix: null },
        { id: 'claude', label: 'Claude Code CLI (claude) found', state: 'ok', detail: '2.1.0 (Claude Code) (sample data)', fix: null },
      ],
      login: 'you',
      canContinue: true,
      agentAvailable: true,
    };
  }

  private draft(): SetupDraft {
    const sources = setupSources(this.material);
    return mapSetupDraft({ answer: SAMPLE_ANSWER, sources, repos: rankActivityRepos(this.material.prs), model: 'opus' });
  }

  private async walk(job: NonNullable<FakeSetup['sweep']>): Promise<void> {
    for (const [index, line] of SWEEP_SCRIPT.entries()) {
      const shown: SetupSweepLine = { step: line.step, text: line.running, state: 'running' };
      job.lines.push(shown);
      await delay(this.deps.stepMs * (STEP_WEIGHTS[index] ?? 1));
      shown.text = line.done;
      shown.state = line.state;
    }
    job.draft = this.draft();
  }

  startSweep(): SetupSweepView {
    if (!this.running) {
      const job = { startedAt: this.deps.now().toISOString(), finishedAt: null as string | null, lines: [] as SetupSweepLine[], draft: null as SetupDraft | null };
      this.sweep = job;
      this.running = this.walk(job).finally(() => {
        job.finishedAt = this.deps.now().toISOString();
        this.running = null;
      });
    }
    return this.sweepView()!;
  }

  sweepView(): SetupSweepView | null {
    if (!this.sweep) {
      return null;
    }
    const current = this.deps.instructions.view();
    return {
      running: this.running !== null,
      startedAt: this.sweep.startedAt,
      finishedAt: this.sweep.finishedAt,
      lines: this.sweep.lines.map((line) => ({ ...line })),
      draft: this.sweep.draft,
      error: null,
      current: { text: current.text, version: current.version },
    };
  }

  /** Stand-in for setup_refine: keeps the edits and files the user's words as a new line under Preferences. */
  async refine(request: SetupRefineRequest): Promise<SetupRefineResult> {
    const previous = this.sweep?.draft ?? null;
    if (!previous || this.running) {
      return { ok: false, message: 'No finished sweep to refine. Run the sweep again.', draft: null, changedSections: [] };
    }
    await delay(this.deps.stepMs * 2);
    const point = request.message.trim().replace(/^[-*]\s*/, '');
    const edits = request.sections.map((section) =>
      section.heading === 'Preferences' ? { ...section, body: `${section.body.trim()}\n- ${point}`.trim() } : section,
    );
    const userLines = new Set([...userWrittenLines(request.sections, previous), claimKey(point)]);
    const agentSources = new Map(previous.sections.flatMap((section) => section.claims.map((claim) => [claimKey(claim.text), claim.sourceIds] as const)));
    const answer: SetupDraftAnswer = {
      summary: previous.summary,
      sections: edits.map((section) => ({
        heading: section.heading,
        claims: section.body
          .split('\n')
          .filter((line) => line.trim() !== '')
          .map((line) => ({ text: line, sources: [...(agentSources.get(claimKey(line)) ?? [])] })),
      })),
      quietRepos: previous.quietRepos.map((repo) => ({ repo: repo.repo, why: repo.why, sources: repo.sourceIds })),
      mainRepo: previous.mainRepo ? { repo: previous.mainRepo.repo, why: previous.mainRepo.why, sources: previous.mainRepo.sourceIds } : null,
    };
    const draft = mapSetupDraft({ answer, sources: previous.sources, repos: previous.repos, model: previous.model, userLines });
    this.sweep!.draft = draft;
    const changedSections = changedHeadings(formatInstructionsSections(request.sections), formatInstructionsSections(draft.sections));
    return { ok: true, message: 'Added your point under Preferences (sample data).', draft, changedSections };
  }

  accept(request: SetupAcceptRequest): SetupAcceptResult {
    const text = formatInstructionsSections(request.sections);
    const current = this.deps.instructions.view();
    if (text.trim() === '') {
      return { ok: false, message: 'The draft is empty. Write at least one section, or skip setup for now.', undoToken: null, savedVersion: null, current: null };
    }
    if (current.version !== request.baseVersion) {
      return {
        ok: false,
        message: 'Your instructions changed since the draft was made. Check the diff against them and accept again.',
        undoToken: null,
        savedVersion: null,
        current: { text: current.text, version: current.version },
      };
    }
    const saved = text === current.text ? null : this.deps.instructions.saveFromSetup(text, current.text.trim() === '' ? 'Written with setup' : 'Rewritten with setup');
    request.quietRepos.forEach((repo) => this.deps.setQuiet(repo));
    this.deps.setScope(request.mainRepo);
    this.flag = { flag: 'done', at: this.deps.now().toISOString() };
    const quiet = request.quietRepos.length > 0 ? ` · ${request.quietRepos.length} quiet` : '';
    const message = `${saved === null ? 'Your instructions already said this' : `Saved your instructions as version ${saved}`}${quiet} · ${request.mainRepo ? `scope ${request.mainRepo}` : 'all repos'} (sample data).`;
    return { ok: true, message, undoToken: null, savedVersion: saved, current: null };
  }

  skip(): ActionResult {
    this.flag = { flag: 'skipped', at: this.deps.now().toISOString() };
    return { ok: true, message: 'Setup skipped. Run it any time from Your instructions.', undoToken: null };
  }
}
