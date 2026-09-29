import { INSTRUCTIONS_MAX_CHARS, type AgentService } from '@postpile/agent';
import {
  changedHeadings,
  formatInstructionsSections,
  normalizeRepoScope,
  userWrittenLines,
  withQuietRepo,
  type ActionResult,
  type SetupAcceptRequest,
  type SetupAcceptResult,
  type SetupChecksView,
  type SetupFitRequest,
  type SetupFitResult,
  type SetupRefineRequest,
  type SetupRefineResult,
  type SetupStatus,
  type SetupSweepView,
} from '@postpile/core';
import type { Store } from '@postpile/store';
import { errorText } from '../errors.ts';
import type { InstructionsHistory } from '../instructions/history.ts';
import { loadRepoSettings, saveRepoSettings } from '../repo-settings.ts';
import type { SetupChecks } from './setup-checks.ts';
import { loadSetupFlag, saveSetupFlag } from './setup-flag.ts';
import type { SetupSweep } from './setup-sweep.ts';

const REPO_NAME = /^[^/\s]+\/[^/\s]+$/;

function refused(message: string, current: SetupAcceptResult['current'] = null): SetupAcceptResult {
  return { ok: false, message, undoToken: null, savedVersion: null, current };
}

/**
 * The setup flow behind one class: when it shows, the checks, the sweep
 * job, refining the draft and accepting it. Accept is the only write:
 * instructions.md as a new version (origin setup, never a silent
 * overwrite), the quiet repos, the repo scope and the done flag. All local;
 * nothing goes to GitHub.
 */
export class SetupFlow {
  constructor(
    private readonly store: Store,
    private readonly agent: AgentService,
    private readonly history: InstructionsHistory,
    private readonly checks: SetupChecks,
    private readonly sweep: SetupSweep,
    private readonly now: () => Date,
  ) {}

  /** First run: instructions.md missing or empty, and never accepted or skipped. */
  status(): SetupStatus {
    const stored = loadSetupFlag(this.store);
    const hasInstructions = this.history.current().text.trim() !== '';
    return { needed: !hasInstructions && stored === null, flag: stored?.flag ?? null, flaggedAt: stored?.at ?? null, hasInstructions };
  }

  runChecks(): Promise<SetupChecksView> {
    return this.checks.run();
  }

  startSweep(): SetupSweepView {
    return this.sweep.start();
  }

  sweepView(): SetupSweepView | null {
    return this.sweep.view();
  }

  /** One setup_refine call over the sweep's material. Writes nothing; the new draft replaces the kept one. */
  async refine(request: SetupRefineRequest): Promise<SetupRefineResult> {
    const result = this.sweep.result();
    if (!result) {
      return { ok: false, message: 'No finished sweep to refine. Run the sweep again.', draft: null, changedSections: [] };
    }
    const before = formatInstructionsSections(request.sections);
    try {
      const answer = await this.agent.refineSetup({
        material: result.material,
        sources: result.sources,
        repos: result.repos,
        current: this.history.current().text,
        draft: request.sections,
        message: request.message,
        earlierMessages: [...result.messages],
        userLines: userWrittenLines(request.sections, result.draft),
      });
      result.messages.push(request.message);
      result.draft = answer.draft;
      const after = formatInstructionsSections(answer.draft.sections);
      return { ok: true, message: answer.reply || 'Changed the draft.', draft: answer.draft, changedSections: changedHeadings(before, after) };
    } catch (error) {
      return { ok: false, message: `The agent could not change the draft: ${errorText(error)}`, draft: null, changedSections: [] };
    }
  }

  /**
   * One setup_fit call over the text the user is about to accept: notes on
   * lines PostPile cannot act on, lines under the wrong heading and vague
   * ones. Writes nothing; the user decides what to change.
   */
  async checkFit(request: SetupFitRequest): Promise<SetupFitResult> {
    if (formatInstructionsSections(request.sections).trim() === '') {
      return { ok: true, message: '', notes: [] };
    }
    try {
      return { ok: true, message: '', notes: await this.agent.checkSetupFit({ sections: request.sections }) };
    } catch (error) {
      return { ok: false, message: `The agent could not check the text: ${errorText(error)}`, notes: [] };
    }
  }

  /**
   * Writes the reviewed draft as a new instructions version, applies the
   * quiet repos and the scope, and stores the done flag. Refused when
   * instructions.md changed since the draft was reviewed (that edit is kept
   * as its own version), so the user sees the diff against it first.
   */
  accept(request: SetupAcceptRequest): SetupAcceptResult {
    const text = formatInstructionsSections(request.sections);
    if (text.trim() === '') {
      return refused('The draft is empty. Write at least one section, or skip setup for now.');
    }
    if (text.length > INSTRUCTIONS_MAX_CHARS) {
      return refused(`Instructions are limited to ${INSTRUCTIONS_MAX_CHARS} characters.`);
    }
    const repos = [...request.quietRepos, ...(request.mainRepo ? [request.mainRepo] : [])];
    const badRepo = repos.find((repo) => !REPO_NAME.test(repo));
    if (badRepo !== undefined) {
      return refused(`"${badRepo}" is not a repo name (owner/name).`);
    }
    const current = this.history.current();
    const currentVersion = current.version?.version ?? null;
    if (currentVersion !== request.baseVersion) {
      return refused('Your instructions changed on disk since the draft was made. Check the diff against them and accept again.', {
        text: current.text,
        version: currentVersion,
      });
    }
    let saved: number | null = null;
    if (text !== current.text) {
      saved = this.history.saveFromSetup(text, current.text.trim() === '' ? 'Written with setup' : 'Rewritten with setup').version;
    }
    let settings = loadRepoSettings(this.store);
    for (const repo of request.quietRepos) {
      settings = withQuietRepo(settings, repo, true);
    }
    saveRepoSettings(this.store, { ...settings, scope: normalizeRepoScope(request.mainRepo) });
    saveSetupFlag(this.store, 'done', this.now().toISOString());
    const parts = [
      saved === null ? 'Your instructions already said this' : `Saved your instructions as version ${saved}`,
      request.quietRepos.length > 0 ? `${request.quietRepos.length} quiet ${request.quietRepos.length === 1 ? 'repo' : 'repos'}` : null,
      request.mainRepo ? `scope ${request.mainRepo}` : 'all repos',
    ];
    return { ok: true, message: `${parts.filter(Boolean).join(' · ')}.`, undoToken: null, savedVersion: saved, current: null };
  }

  skip(): ActionResult {
    saveSetupFlag(this.store, 'skipped', this.now().toISOString());
    return { ok: true, message: 'Setup skipped. Run it any time from Your instructions.', undoToken: null };
  }
}
