import {
  blankSetupDraft,
  changedHeadings,
  claimKey,
  formatInstructionsSections,
  mapSetupDraft,
  mapSetupFit,
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
  type SetupFitAnswer,
  type SetupFitRequest,
  type SetupFitResult,
  type SetupMaterial,
  type SetupRefineRequest,
  type SetupRefineResult,
  type SetupStatus,
  type SetupSweepLine,
  type SetupSweepView,
  type TeamRolesView,
  type Viewer,
} from '@postpile/core';
import type { FakeInstructions } from './fake-instructions.ts';
import { headingFor } from './fake-placement.ts';

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
  samplePr('acme/app', 1850, 'authored', 'Run backend tests on Depot runners', ['.github/', 'bin/']),
  samplePr('acme/app', 1862, 'authored', 'Turbo remote cache for the frontend build', ['.github/', 'frontend/'], 'OPEN'),
  samplePr('acme/app', 1871, 'authored', 'Split the backend suite into even shards', ['.github/', 'backend/']),
  samplePr('acme/app', 1903, 'review_requested', 'Playwright shards on Depot', ['.github/', 'playwright/'], 'OPEN'),
  samplePr('acme/app', 1790, 'reviewed', 'Bump the Node version in CI', ['.github/']),
  samplePr('acme/app', 1802, 'reviewed', 'Cache pnpm store between jobs', ['.github/']),
  samplePr('acme/infra', 1915, 'reviewed', 'DEPOT_TOKEN as repo secret', ['terraform/']),
  samplePr('acme/infra', 1918, 'reviewed', 'Runner pool sizing', ['terraform/']),
  samplePr('acme/python-sdk', 1925, 'reviewed', 'Release workflow cleanup', ['.github/']),
  samplePr('acme/desktop', 1940, 'reviewed', 'Fix a typo in the README', ['(root)']),
];

const SAMPLE_CODEOWNERS = [
  { repo: 'acme/app', path: '.github/CODEOWNERS', lines: ['/.github/workflows/ @acme/team-platform', '/bin/ci/ @acme/team-platform'] },
  { repo: 'acme/infra', path: 'CODEOWNERS', lines: ['/terraform/runners/ @acme/team-platform'] },
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
        { text: 'I work on developer experience on acme/team-platform: CI, build tooling, local dev.', sources: ['t1', 'p1', 'p3'] },
        { text: 'Right now I am moving the monorepo CI to Depot.', sources: ['d1', 'p1'] },
      ],
    },
    {
      heading: 'What I own',
      claims: [
        { text: 'GitHub workflows and CI scripts in acme/app (.github/workflows/, bin/ci/).', sources: ['o1', 'p1', 'p3'] },
        { text: 'Runner config in acme/infra (terraform/runners/).', sources: ['o2', 'p8'] },
        { text: 'The Turbo cache and test sharding setup.', sources: ['p2', 'p3', 'd1'] },
      ],
    },
    {
      heading: 'What gets routed to me',
      claims: [
        { text: 'Reviews for team-platform on CI and workflow changes; I look at cost, cache keys and flakiness.', sources: ['p4', 'p5', 'p6'] },
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
    { repo: 'acme/desktop', why: 'One README review, nothing you own.', sources: ['p10'] },
    { repo: 'acme/python-sdk', why: 'A single drive-by review of a release workflow.', sources: ['p9'] },
  ],
  mainRepo: { repo: 'acme/app', why: 'All your own PRs and most reviews are here.', sources: ['p1', 'p2', 'p3'] },
};

interface FakeLine {
  step: SetupSweepLine['step'];
  running: string;
  done: string;
  state: SetupSweepLine['state'];
}

const SWEEP_SCRIPT: FakeLine[] = [
  {
    step: 'viewer',
    running: 'Reading your GitHub profile and teams…',
    done: 'Signed in as @you · teams acme/team-platform, acme/client-approvers · 4 teammates',
    state: 'done',
  },
  {
    step: 'teams',
    running: 'Reading how your reviews of the last 90 days reached you…',
    done: 'Home team: team-platform (57% of your reviews came through it) · Routing only: client-approvers (4% of your reviews came through it)',
    state: 'done',
  },
  {
    step: 'activity',
    running: 'Searching your PRs of the last 30 days…',
    done: 'Found 10 PRs in 30 days: 3 you wrote, 6 you reviewed, 1 waiting on your review · 4 repos',
    state: 'done',
  },
  {
    step: 'codeowners',
    running: 'Reading CODEOWNERS and owners.yaml in acme/app, acme/infra, acme/python-sdk, acme/desktop…',
    done: 'Ownership files: 3 rules name you or your teams (acme/app .github/CODEOWNERS, acme/infra CODEOWNERS)',
    state: 'done',
  },
  { step: 'digest', running: 'Looking for your work context digest…', done: 'Using your work context digest v3 (2026-09-27)', state: 'done' },
  { step: 'draft', running: 'Asking the agent for a draft (opus)…', done: 'Draft ready: 5 sections, 2 quiet repo suggestions', state: 'done' },
];

/** How long each sweep line "works", relative to the step delay: the draft takes longest. */
const STEP_WEIGHTS = [1, 1.5, 2, 1.5, 0.5, 4];

export interface FakeSetupDeps {
  instructions: FakeInstructions;
  viewer: () => Viewer;
  /** The sample's team roles, shown with a flip per team under the sweep. */
  teamRoles: () => TeamRolesView;
  setQuiet: (repo: string) => void;
  setScope: (repo: string | null) => void;
  now: () => Date;
  /** POSTPILE_FAKE_SETUP=1: the flow shows on start until accepted or skipped. */
  forced: boolean;
  /** Base delay of the canned checks, sweep lines and refine. Tests pass 0. */
  stepMs: number;
  /** The claude headline while the agent is off (POSTPILE_FAKE_MISSING=claude or claude-auth); null otherwise. */
  agentOff: () => string | null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The setup flow for FakeEngine: canned checks, a sweep that walks its
 * lines after short delays, a canned draft built with the real rules
 * (setupSources, mapSetupDraft), a refine that files the user's point
 * under the section it is about, and an accept that writes to the in-memory
 * instructions. Without claude the draft fails into the engine's blank
 * draft. Nothing touches GitHub, the agent or the disk.
 */
export class FakeSetup {
  private flag: { flag: 'done' | 'skipped'; at: string } | null = null;
  private sweep: { startedAt: string; finishedAt: string | null; lines: SetupSweepLine[]; draft: SetupDraft | null; error: string | null } | null = null;
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
        { id: 'gh_auth', label: 'Logged in to GitHub', state: 'ok', detail: 'Logged in as @you · 2 teams', fix: null },
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

  /** Like SetupSweep.draft when the agent call fails: a failed line, the error, and the engine's blank draft. */
  private failedDraft(job: NonNullable<FakeSetup['sweep']>, line: SetupSweepLine, agentOff: string): SetupDraft {
    const message = `The agent could not write a draft: ${agentOff}`;
    line.text = message;
    line.state = 'failed';
    job.error = message;
    const reason = 'No agent draft this time. Start from these headings and write it in your words.';
    return blankSetupDraft(setupSources(this.material), rankActivityRepos(this.material.prs), reason);
  }

  private async walk(job: NonNullable<FakeSetup['sweep']>): Promise<void> {
    for (const [index, line] of SWEEP_SCRIPT.entries()) {
      const shown: SetupSweepLine = { step: line.step, text: line.running, state: 'running' };
      job.lines.push(shown);
      await delay(this.deps.stepMs * (STEP_WEIGHTS[index] ?? 1));
      const agentOff = this.deps.agentOff();
      if (line.step === 'draft' && agentOff !== null) {
        job.draft = this.failedDraft(job, shown, agentOff);
        return;
      }
      shown.text = line.done;
      shown.state = line.state;
    }
    job.draft = this.draft();
  }

  startSweep(): SetupSweepView {
    if (!this.running) {
      const job = { startedAt: this.deps.now().toISOString(), finishedAt: null as string | null, lines: [] as SetupSweepLine[], draft: null as SetupDraft | null, error: null as string | null };
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
      error: this.sweep.error,
      current: { text: current.text, version: current.version },
      teamRoles: this.deps.teamRoles(),
    };
  }

  /**
   * Stand-in for setup_refine: keeps the edits and files the user's words as
   * a new line under the section they are about (by keywords, see
   * fake-placement.ts), Preferences when none fits.
   */
  async refine(request: SetupRefineRequest): Promise<SetupRefineResult> {
    const previous = this.sweep?.draft ?? null;
    if (!previous || this.running) {
      return { ok: false, message: 'No finished sweep to refine. Run the sweep again.', draft: null, changedSections: [] };
    }
    await delay(this.deps.stepMs * 2);
    const point = request.message.trim().replace(/^[-*]\s*/, '');
    const heading = headingFor(point, request.sections.map((section) => section.heading), 'Preferences');
    const edits = request.sections.map((section) =>
      section.heading === heading ? { ...section, body: `${section.body.trim()}\n- ${point}`.trim() } : section,
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
    return { ok: true, message: `Added your point under ${heading} (sample data).`, draft, changedSections };
  }

  /**
   * Stand-in for setup_fit, by keywords: a line about pushing, merging or
   * committing has no effect, an "ignore ..." line outside the quiet
   * section belongs there, and a line of two words or fewer is too vague.
   */
  async checkFit(request: SetupFitRequest): Promise<SetupFitResult> {
    await delay(this.deps.stepMs * 2);
    const answer: SetupFitAnswer = { notes: [] };
    for (const section of request.sections) {
      for (const raw of section.body.split('\n')) {
        const line = raw.replace(/^[-*]\s*/, '').trim();
        const words = line.toLowerCase();
        if (/\b(push|pushes|merge|merges|commit|commits|branch|branches)\b/.test(words)) {
          answer.notes.push({ heading: section.heading, line, kind: 'no_effect', why: 'PostPile never pushes, commits or merges.', moveTo: null, rewrite: null });
        } else if (words.startsWith('ignore') && section.heading !== 'What to ignore or keep quiet') {
          answer.notes.push({ heading: section.heading, line, kind: 'wrong_section', why: 'This is about what to keep quiet.', moveTo: 'What to ignore or keep quiet', rewrite: null });
        } else if (line !== '' && line.split(/\s+/).length <= 2) {
          answer.notes.push({ heading: section.heading, line, kind: 'unclear', why: 'Too short to act on.', moveTo: null, rewrite: 'Lead each summary with what needs me' });
        }
      }
    }
    return { ok: true, message: '', notes: mapSetupFit(answer, request.sections) };
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
