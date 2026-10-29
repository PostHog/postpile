import { useEffect, useRef, useState } from 'react';
import type { ScoutCheckResult, ScoutIntroState } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { sendTelemetry } from '../api/telemetry.ts';
import { useAgentOffReason } from '../api/tools.ts';
import { checkBlockedReason, checkingText, draftFailedToLoad, initialRepos, promptPlaceholder, textAfterDraft, turnOnBlockedReason } from '../lib/scout-intro.ts';
import { holdMenuOpen } from '../lib/open-menus.ts';
import { checkedVersions, currentVersion, labelsForRequest, pushVersion, undoVersion, type ScoutLabels, type ScoutVersion } from '../lib/scout-tighten.ts';
import { Button } from './Button.tsx';
import { ScoutCheckScreen } from './ScoutCheckScreen.tsx';
import { ScoutIntroArt } from './ScoutIntroArt.tsx';
import { ScoutRepoPicker } from './ScoutRepoPicker.tsx';
import { ScoutTrialSection } from './ScoutTrialSection.tsx';

function WarningMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="mt-px shrink-0">
      <path d="M8 1.5l7 12.5H1z" fill="var(--amber)" stroke="var(--amber-ink)" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M8 6v4M8 11.9v0.2" stroke="var(--amber-ink)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The card's top: the searchlight, what is new and what a scout does. */
function IntroHeader() {
  return (
    <div className="flex items-start gap-[18px]">
      <ScoutIntroArt size="card" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="self-start rounded-full bg-sea-soft px-2 py-0.5 text-[10.5px] leading-[normal] font-bold tracking-[0.06em] text-sea-ink">NEW IN 0.29</span>
        <h2 id="scout-intro-title" className="text-[19px] leading-tight font-[650] text-ink">
          Scouts: see the PRs that never reach your inbox
        </h2>
        <p className="text-[13px] leading-normal text-ink-2">
          Your inbox only holds PRs someone pinged you on. A scout reads the titles and changed files of new PRs in a repo every hour and pulls in the few that match what you describe here.
        </p>
      </div>
    </div>
  );
}

/** What the card says about where finds go, and the warning on the label. */
function IntroFineprint() {
  return (
    <>
      <p className="text-[12.5px] leading-[1.45] text-ink-2">
        Finds wait in their own <strong className="font-semibold text-ink">Scouted</strong> section: never unread, never a ping, nothing on GitHub until you Follow.
      </p>
      <div className="flex items-start gap-2.5 rounded-[10px] bg-amber-soft px-3 py-2.5">
        <WarningMark />
        <span className="text-[12.5px] leading-[1.45] text-amber-ink">
          <strong className="font-semibold">Side effects may include</strong> more PRs, more opinions, and a sudden urge to review other teams' folders. A scout's whole job is to fill the attention span you just cleared. Use responsibly.
        </span>
      </div>
    </>
  );
}

/**
 * The Scouts intro card (DESIGN.md "Scouts" › The intro card). Two screens
 * in one dialog: the prompt with its repos, then the check of it. The
 * prompt is drafted once per opening into an untouched box; "Check scout"
 * runs the agent's check and a dry run that saves nothing; "Turn on scout"
 * appends the scout to scouts.md. "Not now" stops it opening by itself;
 * Esc only closes it for this session. `hidden` keeps it mounted behind
 * another first-run overlay. `trigger` says how this opening came about,
 * for telemetry's intro funnel (scout_intro_shown, scout_intro_closed).
 */
export function ScoutIntroCard(props: { state: ScoutIntroState; hidden: boolean; trigger: 'auto' | 'manual'; onClose: () => void }) {
  const actions = useActions();
  const agentOff = useAgentOffReason();
  const { onClose, hidden } = props;
  const [prompt, setPrompt] = useState('');
  const [repos, setRepos] = useState<string[]>(() => initialRepos(props.state));
  const [drafting, setDrafting] = useState(true);
  const [draftFailed, setDraftFailed] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<ScoutCheckResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [name, setName] = useState('');
  // The versions after a check, newest last: "Tighten" pushes one, Undo pops one. Turn on writes the newest.
  const [versions, setVersions] = useState<ScoutVersion[] | null>(null);
  // Want / Noise by PR key; they carry over between versions and checks. Never stored.
  const [labels, setLabels] = useState<ScoutLabels>({});
  const [tightenError, setTightenError] = useState<string | null>(null);
  // Set by the first keystroke: a draft that lands later never overwrites it. A ref, so the draft's promise reads it now.
  const typed = useRef(false);
  // One draft per opening: StrictMode runs the effect twice, and each run would be an agent call.
  const draftAsked = useRef(false);
  // One scout_intro_shown per opening, for the same reason.
  const shownSent = useRef(false);
  // False once this card is gone: a Turn on or Not now that settles after Esc and a reopen must not close the new card.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The draft, on open and from Retry after a failed one. A draft that lands after typing never replaces it.
  function runDraft() {
    setDrafting(true);
    setDraftFailed(false);
    void actions.draftScout().then((draft) => {
      if (!mounted.current) {
        return;
      }
      setDrafting(false);
      setDraftFailed(draftFailedToLoad(draft));
      const text = textAfterDraft(draft, typed.current);
      if (text !== null) {
        setPrompt(text);
        setDrafted(true);
      }
    });
  }

  useEffect(() => {
    if (shownSent.current) {
      return;
    }
    shownSent.current = true;
    sendTelemetry('scout_intro_shown', { trigger: props.trigger });
    // Once per opening: the trigger is how this opening came about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (draftAsked.current) {
      return;
    }
    draftAsked.current = true;
    runDraft();
    // Once per opening: runDraft reads the latest actions when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While the card shows, the PR behind it must not be marked read: the card holds the open-read dwell like a menu.
  useEffect(() => {
    if (hidden) {
      return;
    }
    return holdMenuOpen();
  }, [hidden]);

  useEffect(() => {
    if (hidden) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        sendTelemetry('scout_intro_closed', { stage: showResult ? 'check' : 'card', action: 'escape' });
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hidden, showResult]);

  async function check() {
    setChecking(true);
    setRefusal(null);
    const checked = await actions.checkScout({ prompt: prompt.trim(), repos });
    setChecking(false);
    if (!checked.ok) {
      setRefusal(checked.message ?? 'The check did not run.');
      return;
    }
    setResult(checked);
    setVersions(checkedVersions(prompt.trim(), checked.paths, checked.trial));
    setTightenError(null);
    setName(checked.name);
    setShowResult(true);
  }

  // One scout_refine call from the labels, then the dry run again on the same PRs; the new version goes on top.
  async function tighten() {
    const current = versions === null ? null : currentVersion(versions);
    const session = current?.trial?.session ?? null;
    if (current === null || session === null) {
      return;
    }
    setTightenError(null);
    const answer = await actions.refineScout({ session, name: name.trim(), prompt: current.prompt, repos, paths: current.paths, labels: labelsForRequest(labels) });
    if (!mounted.current) {
      return;
    }
    if (!answer.ok || answer.refined === null) {
      setTightenError(answer.message ?? 'The tightening did not run.');
      return;
    }
    const refined = answer.refined;
    const tightening = { summary: refined.summary, droppedHints: refined.droppedHints, lostWants: answer.lostWants };
    setVersions((now) => (now === null ? now : pushVersion(now, { prompt: refined.prompt, paths: refined.paths, trial: answer.trial, tightening })));
    setPrompt(refined.prompt);
  }

  // "Undo this tightening": back one version, its prompt in the textarea too.
  function undoTightening() {
    if (versions === null || versions.length < 2) {
      return;
    }
    const back = undoVersion(versions);
    setVersions(back);
    setPrompt(currentVersion(back).prompt);
    setTightenError(null);
    sendTelemetry('scout_tighten_undone', {});
  }

  // The check ran on the old prompt: its counts, examples and Turn on no longer hold, so back to Check on the new one.
  function dropPart(rewrite: string) {
    setPrompt(rewrite);
    setResult(null);
    setVersions(null);
    setShowResult(false);
    setRefusal('Dropped that part. Check the scout again to see what it finds now.');
  }

  // Closes only once the answer is saved; a failed save shows its toast and keeps the card and the button.
  async function notNow() {
    if ((await actions.dismissScoutIntro()) && mounted.current) {
      sendTelemetry('scout_intro_closed', { stage: showResult ? 'check' : 'card', action: 'not_now' });
      onClose();
    }
  }

  // Writes the version the card shows: the checked one, or the newest tightening.
  async function turnOn() {
    if (versions === null) {
      return;
    }
    const current = currentVersion(versions);
    if ((await actions.turnOnScout({ name: name.trim(), prompt: current.prompt, repos, paths: current.paths })) && mounted.current) {
      onClose();
    }
  }

  const checkBlocked = checkBlockedReason({ prompt, repos, agentOff });
  const turnOnBusy = actions.isBusy('scout:turn-on');
  const tightening = actions.isBusy('scout:refine');
  const turnOnBlocked = tightening ? 'Wait for the tightening to finish' : turnOnBlockedReason(name);
  const notNowButton = (
    <Button size="md" disabled={actions.isBusy('scout:dismiss-intro')} title="The card stops opening by itself. Set up a scout from the Scouted section any time." onClick={() => void notNow()}>
      Not now
    </Button>
  );

  return (
    <div className={`fixed inset-0 z-40 flex items-center justify-center bg-ink/20 p-4 ${hidden ? 'hidden' : ''}`}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scout-intro-title"
        className="flex max-h-full w-[580px] max-w-full flex-col gap-4 overflow-y-auto rounded-[16px] bg-surface px-7 pt-[26px] pb-[22px] shadow-menu"
      >
        {showResult && result && versions ? (
          <>
            <ScoutCheckScreen result={result} trial={currentVersion(versions).trial} repos={repos} name={name} onName={setName} onDropPart={dropPart} />
            <ScoutTrialSection
              versions={versions}
              repos={repos}
              labels={labels}
              onLabels={setLabels}
              onTighten={() => void tighten()}
              onUndo={undoTightening}
              tightening={tightening}
              tightenError={tightenError}
            />
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => setShowResult(false)} className="px-1 py-2 text-[13px] text-accent hover:text-ink">
                ← Edit prompt
              </button>
              <span className="flex-1" />
              {notNowButton}
              <Button variant="primary" size="md" disabled={turnOnBusy || turnOnBlocked !== null} title={turnOnBlocked ?? undefined} onClick={() => void turnOn()}>
                {turnOnBusy ? 'Turning on…' : 'Turn on scout'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <IntroHeader />
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor="scout-prompt" className="text-xs font-semibold text-ink">
                  What should it look out for?
                </label>
                {drafted && <span className="text-[11.5px] text-hint">Drafted from your instructions · edit freely</span>}
                {draftFailed && (
                  <span className="text-[11.5px] text-hint">
                    Couldn't draft one.{' '}
                    <button type="button" onClick={runDraft} className="text-accent hover:text-ink">
                      Retry
                    </button>
                  </span>
                )}
              </div>
              <textarea
                id="scout-prompt"
                rows={5}
                value={prompt}
                readOnly={checking}
                placeholder={promptPlaceholder(drafting)}
                onChange={(event) => {
                  typed.current = true;
                  setPrompt(event.target.value);
                }}
                className="w-full resize-none rounded-[10px] border border-control bg-surface px-3 py-2.5 text-[13px] leading-normal text-ink outline-none select-text placeholder:text-faint focus:border-accent"
              />
              <ScoutRepoPicker picked={repos} known={props.state.repos} disabled={checking} onChange={setRepos} />
            </div>
            <IntroFineprint />
            {refusal && <p className="rounded-[10px] bg-subtle px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink-2 inset-ring inset-ring-edge-hairline">{refusal}</p>}
            <div className="flex items-center gap-2.5">
              <span className="flex-1 text-[11.5px] text-hint">{checking ? checkingText(repos) : 'Kept in scouts.md beside your instructions.'}</span>
              {notNowButton}
              <Button variant="primary" size="md" disabled={checking || checkBlocked !== null} title={checkBlocked ?? undefined} onClick={() => void check()}>
                {checking ? 'Checking…' : 'Check scout'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
