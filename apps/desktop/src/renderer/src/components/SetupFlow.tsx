import { useState } from 'react';
import type { SetupCurrentInstructions, SetupDraft, SetupSectionEdit } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useSetupSweep } from '../api/setup.ts';
import { editsFromDraft, type SetupStepKey } from '../lib/setup.ts';
import { SetupAcceptStep } from './SetupAcceptStep.tsx';
import { SetupChecksStep } from './SetupChecksStep.tsx';
import { SetupReviewStep } from './SetupReviewStep.tsx';
import { SetupSteps } from './SetupSteps.tsx';
import { SetupSweepStep } from './SetupSweepStep.tsx';

/** What the user is working on in steps 3 and 4: the draft, their edits and picks, and the file it is compared with. */
interface Review {
  draft: SetupDraft;
  edits: SetupSectionEdit[];
  quiet: string[];
  mainRepo: string | null;
  base: SetupCurrentInstructions;
}

function reviewFrom(draft: SetupDraft, base: SetupCurrentInstructions): Review {
  return { draft, edits: editsFromDraft(draft), quiet: draft.quietRepos.map((pick) => pick.repo), mainRepo: draft.mainRepo?.repo ?? null, base };
}

/**
 * The setup flow over the middle and right panes: check the basics, sweep,
 * review the draft, accept. One calm screen per step with the progress
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
  const [review, setReview] = useState<Review | null>(null);
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

  /** A refine replaces the text with the agent's new version (which kept the user's edits) and its picks. */
  function refined(draft: SetupDraft) {
    setReview((current) => current && reviewFrom(draft, current.base));
  }

  function setQuiet(repo: string, quiet: boolean) {
    setReview((current) => current && { ...current, quiet: quiet ? [...current.quiet, repo] : current.quiet.filter((entry) => entry !== repo) });
  }

  function setMainRepo(repo: string | null) {
    // The main repo cannot also be quiet.
    setReview((current) => current && { ...current, mainRepo: repo, quiet: current.quiet.filter((entry) => entry !== repo) });
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
        quiet={review.quiet}
        onQuiet={setQuiet}
        mainRepo={review.mainRepo}
        onMainRepo={setMainRepo}
        onContinue={() => onStep('accept')}
        onBack={() => onStep('sweep')}
      />
    );
  } else if (step === 'accept' && review) {
    screen = (
      <SetupAcceptStep
        edits={review.edits}
        base={review.base}
        quiet={review.quiet}
        mainRepo={review.mainRepo}
        onBaseChanged={(base) => {
          setReview({ ...review, base });
          onStep('review');
        }}
        onDone={props.onDone}
        onBack={() => onStep('review')}
      />
    );
  }

  return (
    <main className="col-span-2 flex min-w-0 flex-col gap-[18px] overflow-auto px-[26px] py-[22px]">
      <div className="flex flex-col gap-2">
        <h1 className="text-[23px] leading-tight font-[650] tracking-[-0.022em]">{props.rerun ? 'Run setup again' : 'Welcome to PostPile'}</h1>
        <p className="max-w-[720px] text-[13px] text-ink-2">
          {props.rerun
            ? 'The agent drafts your instructions again from your recent GitHub activity. You see it as a diff against your current file; nothing changes until you accept.'
            : 'An agent helps you write your instructions: who you are, what you own, what should reach you. It reads your recent GitHub activity and drafts them; you review and edit before anything is saved.'}
        </p>
        <SetupSteps current={step} />
      </div>
      {screen}
    </main>
  );
}
