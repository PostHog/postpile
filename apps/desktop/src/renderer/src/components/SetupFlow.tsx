import { useState } from 'react';
import type { InterruptionsMode, SetupCurrentInstructions, SetupDraft, SetupFitNote, SetupSectionEdit } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useInterruptions } from '../api/interruptions.ts';
import { useSetupStatus, useSetupSweep } from '../api/setup.ts';
import { sendTelemetry } from '../api/telemetry.ts';
import {
  applyFitFix,
  draftText,
  editsFromDraft,
  fitAfterAnswer,
  pickMainRepo,
  picksAfterRefine,
  picksFromDraft,
  setupHeading,
  toggleQuiet,
  type SetupFitFix,
  type SetupFitState,
  type SetupPicks,
  type SetupStepKey,
} from '../lib/setup.ts';
import { FALLBACK_INTERRUPTIONS } from '../lib/interruptions.ts';
import { SetupAcceptStep } from './SetupAcceptStep.tsx';
import { SetupChecksStep } from './SetupChecksStep.tsx';
import { SetupDayStep } from './SetupDayStep.tsx';
import { SetupReviewStep } from './SetupReviewStep.tsx';
import { SetupSteps } from './SetupSteps.tsx';
import { SetupSweepStep } from './SetupSweepStep.tsx';

/** What the user is working on from step 3 on: the draft, their edits and picks, and the file it is compared with. */
interface Review {
  draft: SetupDraft;
  edits: SetupSectionEdit[];
  picks: SetupPicks;
  base: SetupCurrentInstructions;
  /** The fit check of the text as it was when the user went to Accept; kept so going back and forth does not ask again. */
  fit: SetupFitState | null;
}

function reviewFrom(draft: SetupDraft, base: SetupCurrentInstructions): Review {
  return { draft, edits: editsFromDraft(draft), picks: picksFromDraft(draft), base, fit: null };
}

/** The fit check without one note, now matching `edits` (a fix changed the text, a keep did not). */
function fitWithout(fit: SetupFitState | null, note: SetupFitNote, edits: SetupSectionEdit[]): SetupFitState | null {
  if (!fit?.result) {
    return fit;
  }
  return { text: draftText(edits), result: { ...fit.result, notes: fit.result.notes.filter((entry) => entry !== note) } };
}

/**
 * The setup flow over the middle and right panes: check the basics, sweep,
 * review the draft, your day (when PostPile may notify you), accept. One calm screen per step with the progress
 * indicator on top. `rerun` is "Run setup again" from the instructions
 * pane: the skip button then only closes, it stores no flag. A first-run
 * skip stores the flag and hands back to App, which runs the start sync
 * the first run held back.
 */
export function SetupFlow(props: {
  rerun: boolean;
  step: SetupStepKey;
  onStep: (step: SetupStepKey) => void;
  onDone: () => void;
  /** "Close setup" on a re-run: nothing stored. */
  onClose: () => void;
  /** "Skip for now" on a first run, after the skipped flag is stored. */
  onSkipped: () => void;
}) {
  const actions = useActions();
  const sweep = useSetupSweep(props.step === 'sweep');
  const setupDone = useSetupStatus().data?.flag === 'done';
  const [review, setReview] = useState<Review | null>(null);
  const interruptions = useInterruptions().data;
  // The "Your day" pick; until the user picks, the stored mode (Never while it loads).
  const [pickedMode, setPickedMode] = useState<InterruptionsMode | null>(null);
  // What Accept sends: null leaves the stored mode as it is when neither is known.
  const acceptMode = pickedMode ?? interruptions?.mode ?? null;
  const roundupTimes = interruptions?.roundupTimes ?? [];
  const { step, onStep } = props;

  async function startSweep() {
    onStep('sweep');
    await actions.startSetupSweep();
  }

  async function skip() {
    if (props.rerun) {
      props.onClose();
    } else if (await actions.skipSetup()) {
      props.onSkipped();
    }
  }

  function toReview() {
    const view = sweep.data;
    if (view?.draft) {
      setReview(reviewFrom(view.draft, view.current));
      onStep('review');
    }
  }

  function edit(index: number, body: string) {
    setReview((current) => current && { ...current, edits: current.edits.map((entry, at) => (at === index ? { ...entry, body } : entry)) });
  }

  /**
   * A refine replaces the text with the agent's new version (which kept the
   * user's edits). The user's own repo picks stay; untouched quiet toggles
   * follow the new draft.
   */
  function refined(draft: SetupDraft) {
    setReview((current) => current && { ...current, draft, edits: editsFromDraft(draft), picks: picksAfterRefine(current.picks, draft) });
  }

  /**
   * The fit check for the text as it is now, unless it was already checked.
   * The answer is dropped when the text changed while it ran (fitAfterAnswer).
   */
  async function checkFit(edits: SetupSectionEdit[]) {
    const text = draftText(edits);
    if (review?.fit?.text === text && review.fit.result?.ok !== false) {
      return;
    }
    setReview((current) => current && { ...current, fit: { text, result: null } });
    const result = await actions.checkSetupFit({ sections: edits });
    setReview((current) => current && { ...current, fit: fitAfterAnswer(current.fit, draftText(current.edits), text, result) });
  }

  function toAccept() {
    onStep('accept');
    if (review) {
      void checkFit(review.edits);
    }
  }

  function fixFit(note: SetupFitNote, fix: SetupFitFix) {
    setReview((current) => {
      if (!current) {
        return current;
      }
      const edits = applyFitFix(current.edits, note, fix);
      return { ...current, edits, fit: fitWithout(current.fit, note, edits) };
    });
    sendTelemetry('setup_fit_fixed', { kind: note.kind, fix });
  }

  function keepFit(note: SetupFitNote) {
    setReview((current) => current && { ...current, fit: fitWithout(current.fit, note, current.edits) });
  }

  function setQuiet(repo: string, quiet: boolean) {
    setReview((current) => current && { ...current, picks: toggleQuiet(current.picks, repo, quiet) });
  }

  function setMainRepo(repo: string | null) {
    setReview((current) => current && { ...current, picks: pickMainRepo(current.picks, repo) });
  }

  let screen = null;
  if (step === 'checks') {
    screen = <SetupChecksStep onContinue={() => void startSweep()} onSkip={() => void skip()} skipLabel={props.rerun ? 'Close setup' : 'Skip for now'} />;
  } else if (step === 'sweep') {
    screen = (
      <SetupSweepStep
        view={sweep.data}
        starting={actions.isBusy('setup:sweep')}
        onContinue={toReview}
        onRunAgain={() => void startSweep()}
        onBack={() => onStep('checks')}
      />
    );
  } else if (step === 'review' && review) {
    screen = (
      <SetupReviewStep
        draft={review.draft}
        edits={review.edits}
        onEdit={edit}
        onRefined={refined}
        base={review.base}
        quiet={review.picks.quiet}
        onQuiet={setQuiet}
        mainRepo={review.picks.mainRepo}
        onMainRepo={setMainRepo}
        onContinue={() => onStep('day')}
        onBack={() => onStep('sweep')}
      />
    );
  } else if (step === 'day' && review) {
    screen = (
      <SetupDayStep
        mode={acceptMode ?? FALLBACK_INTERRUPTIONS}
        roundupTimes={roundupTimes}
        onPick={setPickedMode}
        onContinue={toAccept}
        onBack={() => onStep('review')}
      />
    );
  } else if (step === 'accept' && review) {
    screen = (
      <SetupAcceptStep
        edits={review.edits}
        base={review.base}
        quiet={review.picks.quiet}
        mainRepo={review.picks.mainRepo}
        interruptions={acceptMode}
        roundupTimes={roundupTimes}
        fit={review.fit}
        onFitFix={fixFit}
        onFitKeep={keepFit}
        onFitRetry={() => void checkFit(review.edits)}
        onBaseChanged={(base) => {
          setReview({ ...review, base });
          onStep('review');
        }}
        onDone={props.onDone}
        onBack={() => onStep('day')}
      />
    );
  }

  return (
    <main className="pane-scroll col-span-2 flex min-w-0 flex-col gap-[18px] overflow-auto pl-[26px] pr-[16px] py-[22px]">
      <div className="flex flex-col gap-2">
        <h1 className="text-[23px] leading-tight font-[650] tracking-[-0.022em]">{setupHeading(props.rerun, setupDone)}</h1>
        <p className="max-w-[720px] text-[13px] text-ink-2">
          {props.rerun
            ? `The agent drafts your instructions ${setupDone ? 'again ' : ''}from your recent GitHub activity. You see it as a diff against your current file; nothing changes until you accept.`
            : 'An agent helps you write your instructions: who you are, what you own, what should reach you. It reads your recent GitHub activity and drafts them; you review and edit before anything is saved.'}
        </p>
        <SetupSteps current={step} />
      </div>
      {screen}
    </main>
  );
}
