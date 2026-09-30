import { modelFor, type AgentService } from '@postpile/agent';
import {
  blankSetupDraft,
  busiestDirs,
  CODEOWNERS_PATHS,
  codeownersLines,
  OWNERS_YAML_FILE,
  ownerHandles,
  ownersYamlHandles,
  ownersYamlLines,
  rankActivityRepos,
  SETUP_ACTIVITY_DAYS,
  SETUP_CODEOWNERS_REPOS,
  SETUP_PR_CAP,
  setupSources,
  TEAM_ROLE_WINDOW_DAYS,
  teamRolesLine,
  withHomeTeams,
  type ActivityPr,
  type CodeownersExcerpt,
  type IsoTime,
  type SetupDraft,
  type SetupLineState,
  type SetupMaterial,
  type SetupRepoCount,
  type SetupSource,
  type SetupSweepLine,
  type SetupSweepStep,
  type SetupSweepView,
  type TeamRoles,
  type Viewer,
} from '@postpile/core';
import type { GitHubReader } from '@postpile/github';
import type { Store } from '@postpile/store';
import { errorText } from '../errors.ts';
import type { InstructionsHistory } from '../instructions/history.ts';
import type { TeamMembers } from '../team-members.ts';
import type { TeamRoleKeeper } from '../team-roles.ts';
import { loadViewer, saveViewer } from '../viewer-meta.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SetupSweepDeps {
  store: Store;
  reader: GitHubReader;
  agent: AgentService;
  teamMembers: TeamMembers;
  teamRoles: TeamRoleKeeper;
  history: InstructionsHistory;
  /** The newest work context digest as prompt text, null when there is none. */
  digest: () => SetupMaterial['digest'];
  now: () => Date;
}

/** What a finished sweep keeps for the refine calls. */
export interface SetupSweepResult {
  material: SetupMaterial;
  sources: SetupSource[];
  repos: SetupRepoCount[];
  draft: SetupDraft;
  /** The user's refine messages so far, oldest first. */
  messages: string[];
}

interface SweepJob {
  startedAt: IsoTime;
  finishedAt: IsoTime | null;
  lines: SetupSweepLine[];
  error: string | null;
  result: SetupSweepResult | null;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function activityLine(prs: ActivityPr[], repos: SetupRepoCount[]): string {
  if (prs.length === 0) {
    return `No PRs in the last ${SETUP_ACTIVITY_DAYS} days`;
  }
  const count = (role: ActivityPr['role']) => prs.filter((pr) => pr.role === role).length;
  return `Found ${plural(prs.length, 'PR')} in ${SETUP_ACTIVITY_DAYS} days: ${count('authored')} you wrote, ${count('reviewed')} you reviewed, ${count('review_requested')} waiting on your review · ${plural(repos.length, 'repo')}`;
}

/**
 * Step 2 of the setup flow, run as a job the UI polls: viewer and teams,
 * the last 30 days of PR activity (one GraphQL request), CODEOWNERS lines
 * and owners.yaml rules of the busiest repos, the work context digest, then one setup_draft
 * call. Each step writes a progress line. Only the viewer is required; a
 * failed later step is noted and the draft uses what came back. A failed
 * agent call leaves the blank template, so the user can still write it.
 * GitHub is only read; the viewer and team members are stored like a sync does.
 */
export class SetupSweep {
  private job: SweepJob | null = null;
  private running: Promise<void> | null = null;

  constructor(private readonly deps: SetupSweepDeps) {}

  /** The finished sweep's material and draft, for refine. Null before one finished with a viewer. */
  result(): SetupSweepResult | null {
    return this.job?.finishedAt ? this.job.result : null;
  }

  isRunning(): boolean {
    return this.running !== null;
  }

  view(): SetupSweepView | null {
    const job = this.job;
    if (!job) {
      return null;
    }
    const current = this.deps.history.current();
    const viewer = loadViewer(this.deps.store);
    return {
      running: this.running !== null,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      lines: job.lines.map((line) => ({ ...line })),
      draft: job.result?.draft ?? null,
      error: job.error,
      current: { text: current.text, version: current.version?.version ?? null },
      teamRoles: viewer ? this.deps.teamRoles.view(viewer) : null,
    };
  }

  /** Starts a sweep and returns right away; a start while one runs joins it. */
  start(): SetupSweepView {
    if (!this.running) {
      const job: SweepJob = { startedAt: this.deps.now().toISOString(), finishedAt: null, lines: [], error: null, result: null };
      this.job = job;
      this.running = this.run(job).finally(() => {
        job.finishedAt = this.deps.now().toISOString();
        this.running = null;
      });
    }
    return this.view()!;
  }

  /** Resolves when the running sweep is done. Tests and the CLI wait on it. */
  async settled(): Promise<void> {
    await this.running;
  }

  private line(job: SweepJob, step: SetupSweepStep, text: string): SetupSweepLine {
    const line: SetupSweepLine = { step, text, state: 'running' };
    job.lines.push(line);
    return line;
  }

  private static finish(line: SetupSweepLine, state: SetupLineState, text: string): void {
    line.state = state;
    line.text = text;
  }

  /**
   * Home or routing per team, from the last 90 days of reviews. Every team
   * again; the user's flips stay. A failure keeps the stored roles (none:
   * every team counts as home) and the sweep goes on.
   */
  private async teamRoles(job: SweepJob, viewer: Viewer): Promise<TeamRoles | null> {
    if (viewer.teams.length === 0) {
      return this.deps.teamRoles.load();
    }
    const line = this.line(job, 'teams', `Reading how your reviews of the last ${TEAM_ROLE_WINDOW_DAYS} days reached you…`);
    try {
      const roles = await this.deps.teamRoles.reclassify(viewer);
      SetupSweep.finish(line, 'done', teamRolesLine(roles, viewer.teams));
      return roles;
    } catch (error) {
      SetupSweep.finish(line, 'failed', `Could not read your reviews to tell your home team: ${errorText(error)}`);
      return this.deps.teamRoles.load();
    }
  }

  private async viewer(job: SweepJob): Promise<Viewer | null> {
    const line = this.line(job, 'viewer', 'Reading your GitHub profile and teams…');
    try {
      const fromGitHub = await this.deps.reader.viewer();
      const roles = await this.teamRoles(job, fromGitHub);
      const viewer = await this.deps.teamMembers.attach(withHomeTeams(fromGitHub, roles));
      saveViewer(this.deps.store, viewer);
      const teams = viewer.teams.length > 0 ? `teams ${viewer.teams.join(', ')}` : 'no teams visible';
      SetupSweep.finish(line, 'done', `Signed in as @${viewer.login} · ${teams} · ${plural(viewer.teamMembers?.length ?? 0, 'teammate')}`);
      return viewer;
    } catch (error) {
      SetupSweep.finish(line, 'failed', `Could not read your GitHub profile: ${errorText(error)}`);
      job.error = `The sweep needs your GitHub profile: ${errorText(error)}`;
      return null;
    }
  }

  private async activity(job: SweepJob, since: IsoTime): Promise<ActivityPr[]> {
    const line = this.line(job, 'activity', `Searching your PRs of the last ${SETUP_ACTIVITY_DAYS} days…`);
    try {
      const prs = (await this.deps.reader.recentActivity(since.slice(0, 10))).slice(0, SETUP_PR_CAP);
      SetupSweep.finish(line, 'done', activityLine(prs, rankActivityRepos(prs)));
      return prs;
    } catch (error) {
      SetupSweep.finish(line, 'failed', `Could not search your PRs: ${errorText(error)}`);
      return [];
    }
  }

  /** The first CODEOWNERS file GitHub would use, cut to the lines naming the user or their teams. */
  private async codeownersOf(repo: string, handles: string[]): Promise<CodeownersExcerpt | null> {
    for (const path of CODEOWNERS_PATHS) {
      const text = await this.deps.reader.readRepoFile(repo, path);
      if (text !== null) {
        const lines = codeownersLines(text, handles);
        return lines.length > 0 ? { repo, path, lines } : null;
      }
    }
    return null;
  }

  /** One owners.yaml (`folder` "" for the root, else "tools/"), cut to the rules naming the user or their teams. */
  private async ownersYamlOf(repo: string, folder: string, handles: string[]): Promise<CodeownersExcerpt | null> {
    const path = `${folder}${OWNERS_YAML_FILE}`;
    const text = await this.deps.reader.readRepoFile(repo, path);
    if (text === null) {
      return null;
    }
    const lines = ownersYamlLines(text, folder, handles);
    return lines.length > 0 ? { repo, path, lines } : null;
  }

  /**
   * owners.yaml rules: the root file, and when the repo has one, the files in
   * the top-level folders the user's PRs touch most. A repo without a root
   * owners.yaml does not use the format, so its folders are not asked.
   */
  private async ownersYamlFiles(repo: string, prs: ActivityPr[], viewer: Viewer): Promise<CodeownersExcerpt[]> {
    const handles = ownersYamlHandles(viewer);
    const rootText = await this.deps.reader.readRepoFile(repo, OWNERS_YAML_FILE);
    if (rootText === null) {
      return [];
    }
    const rootLines = ownersYamlLines(rootText, '', handles);
    const root: CodeownersExcerpt[] = rootLines.length > 0 ? [{ repo, path: OWNERS_YAML_FILE, lines: rootLines }] : [];
    const folders = await Promise.all(busiestDirs(prs, repo).map((dir) => this.ownersYamlOf(repo, dir, handles)));
    return [...root, ...folders.filter((excerpt) => excerpt !== null)];
  }

  private async codeowners(job: SweepJob, repos: SetupRepoCount[], prs: ActivityPr[], viewer: Viewer): Promise<CodeownersExcerpt[]> {
    const top = repos.slice(0, SETUP_CODEOWNERS_REPOS).map((repo) => repo.repo);
    if (top.length === 0) {
      const skipped = this.line(job, 'codeowners', '');
      SetupSweep.finish(skipped, 'skipped', 'Ownership files: no repos to read');
      return [];
    }
    const line = this.line(job, 'codeowners', `Reading CODEOWNERS and owners.yaml in ${top.join(', ')}…`);
    const handles = ownerHandles(viewer);
    const excerpts: CodeownersExcerpt[] = [];
    const failed: string[] = [];
    for (const repo of top) {
      try {
        const codeowners = await this.codeownersOf(repo, handles);
        excerpts.push(...(codeowners ? [codeowners] : []), ...(await this.ownersYamlFiles(repo, prs, viewer)));
      } catch {
        failed.push(repo);
      }
    }
    const lines = excerpts.reduce((sum, excerpt) => sum + excerpt.lines.length, 0);
    const files = excerpts.map((excerpt) => `${excerpt.repo} ${excerpt.path}`);
    const found = excerpts.length > 0 ? `${plural(lines, 'rule')} ${lines === 1 ? 'names' : 'name'} you or your teams (${files.join(', ')})` : `nothing names you or your teams in ${plural(top.length, 'repo')}`;
    const problems = failed.length > 0 ? ` · could not read ${failed.join(', ')}` : '';
    SetupSweep.finish(line, 'done', `Ownership files: ${found}${problems}`);
    return excerpts;
  }

  private digest(job: SweepJob): SetupMaterial['digest'] {
    const line = this.line(job, 'digest', 'Looking for your work context digest…');
    const digest = this.deps.digest();
    if (digest) {
      SetupSweep.finish(line, 'done', `Using your work context digest v${digest.version} (${digest.createdAt.slice(0, 10)})`);
    } else {
      SetupSweep.finish(line, 'skipped', 'No work context digest yet');
    }
    return digest;
  }

  private async draft(job: SweepJob, material: SetupMaterial, sources: SetupSource[], repos: SetupRepoCount[]): Promise<SetupDraft> {
    const line = this.line(job, 'draft', `Asking the agent for a draft (${modelFor('setup_draft')})…`);
    try {
      const current = this.deps.history.current().text;
      const { draft } = await this.deps.agent.draftSetup({ material, sources, repos, current });
      SetupSweep.finish(line, 'done', `Draft ready: ${plural(draft.sections.length, 'section')}, ${plural(draft.quietRepos.length, 'quiet repo suggestion')}`);
      return draft;
    } catch (error) {
      const message = `The agent could not write a draft: ${errorText(error)}`;
      SetupSweep.finish(line, 'failed', message);
      job.error = message;
      return blankSetupDraft(sources, repos, 'No agent draft this time. Start from these headings and write it in your words.');
    }
  }

  private async run(job: SweepJob): Promise<void> {
    const viewer = await this.viewer(job);
    if (!viewer) {
      return;
    }
    const since = new Date(this.deps.now().getTime() - SETUP_ACTIVITY_DAYS * DAY_MS).toISOString();
    const prs = await this.activity(job, since);
    const repos = rankActivityRepos(prs);
    const codeowners = await this.codeowners(job, repos, prs, viewer);
    const digest = this.digest(job);
    const material: SetupMaterial = { viewer, since, prs, codeowners, digest };
    const sources = setupSources(material);
    const draft = await this.draft(job, material, sources, repos);
    job.result = { material, sources, repos, draft, messages: [] };
  }
}
