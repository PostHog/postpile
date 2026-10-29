import { useEffect, useRef, useState } from 'react';
import type { ScoutCheckResult, ScoutIntroState } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useAgentOffReason } from '../api/tools.ts';
import { checkBlockedReason, checkingText, initialRepos, promptPlaceholder, promptWithoutPart, textAfterDraft, turnOnBlockedReason } from '../lib/scout-intro.ts';
import { Button } from './Button.tsx';
import { ScoutCheckScreen } from './ScoutCheckScreen.tsx';
import { ScoutIntroArt } from './ScoutIntroArt.tsx';
import { ScoutRepoPicker } from './ScoutRepoPicker.tsx';

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
 * another first-run overlay.
 */
export function ScoutIntroCard(props: { state: ScoutIntroState; hidden: boolean; onClose: () => void }) {
  const actions = useActions();
  const agentOff = useAgentOffReason();
  const { onClose, hidden } = props;
  const [prompt, setPrompt] = useState('');
  const [repos, setRepos] = useState<string[]>(() => initialRepos(props.state));
  const [drafting, setDrafting] = useState(true);
  const [drafted, setDrafted] = useState(false);
  const [checking, setChecking] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [result, setResult] = useState<ScoutCheckResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [name, setName] = useState('');
  // Set by the first keystroke: a draft that lands later never overwrites it. A ref, so the draft's promise reads it now.
  const typed = useRef(false);
  // One draft per opening: StrictMode runs the effect twice, and each run would be an agent call.
  const draftAsked = useRef(false);

  useEffect(() => {
    if (draftAsked.current) {
      return;
    }
    draftAsked.current = true;
    void actions.draftScout().then((draft) => {
      setDrafting(false);
      const text = textAfterDraft(draft, typed.current);
      if (text !== null) {
        setPrompt(text);
        setDrafted(true);
      }
    });
  }, [actions]);

  useEffect(() => {
    if (hidden) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, hidden]);

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
    setName(checked.name);
    setShowResult(true);
  }

  async function notNow() {
    await actions.dismissScoutIntro();
    onClose();
  }

  async function turnOn() {
    if (result === null) {
      return;
    }
    if (await actions.turnOnScout({ name: name.trim(), prompt: prompt.trim(), repos, paths: result.paths })) {
      onClose();
    }
  }

  const checkBlocked = checkBlockedReason({ prompt, repos, agentOff });
  const turnOnBusy = actions.isBusy('scout:turn-on');
  const turnOnBlocked = turnOnBlockedReason(name);
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
        {showResult && result ? (
          <>
            <ScoutCheckScreen result={result} repos={repos} name={name} onName={setName} onDropPart={(cantSee) => setPrompt(promptWithoutPart(cantSee))} />
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
