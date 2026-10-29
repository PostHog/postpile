import type { ScoutLabel, ScoutTrialExample } from '@postpile/core';
import { useAgentOffReason } from '../api/tools.ts';
import { plural } from '../lib/plural.ts';
import { exampleRef, trialHeading, trialNote, trialSkipped } from '../lib/scout-intro.ts';
import {
  currentVersion,
  labelCount,
  lostWantsText,
  pathsChange,
  previousVersion,
  promptChange,
  setLabelWhy,
  tightenBlockedReason,
  tightenedHeading,
  tightenHint,
  toggleLabel,
  type PromptPart,
  type ScoutLabels,
  type ScoutVersion,
} from '../lib/scout-tighten.ts';
import { Button } from './Button.tsx';

const LABEL_WORDS: Record<ScoutLabel, string> = { want: 'Want', noise: 'Noise' };

/** A path hint chip: green when the tightening added it, struck through when it took it out. */
const HINT_LOOKS: Record<'kept' | 'added' | 'removed', string> = { kept: 'text-ink-2', added: 'text-safe', removed: 'text-hint line-through' };

/** Want or Noise on one example: words, a soft green or grey fill once picked. */
function LabelButton(props: { kind: ScoutLabel; picked: boolean; title: string; onClick: () => void }) {
  let look = 'bg-surface text-hint inset-ring-edge-hairline hover:text-ink';
  if (props.picked) {
    look = props.kind === 'want' ? 'bg-safe-soft text-safe inset-ring-safe/40' : 'bg-subtle text-ink inset-ring-edge-control';
  }
  return (
    <button type="button" aria-pressed={props.picked} title={props.title} onClick={props.onClick} className={`rounded-control px-2 py-[3px] text-[11.5px] leading-[normal] font-medium inset-ring ${look}`}>
      {LABEL_WORDS[props.kind]}
    </button>
  );
}

/** One example to label: the PR, the judge's reason, Want and Noise, and the optional "why" once labeled. */
function ExampleRow(props: { example: ScoutTrialExample; repos: string[]; nearMiss: boolean; labels: ScoutLabels; onLabels: (labels: ScoutLabels) => void }) {
  const { example, labels } = props;
  const entry = labels[example.prKey];
  const wantTitle = props.nearMiss ? 'Should have pulled this one' : 'Keep pulling PRs like this';
  const noiseTitle = props.nearMiss ? 'Right to skip it' : 'Not worth your time';
  return (
    <li className="flex flex-col gap-1.5 border-b border-hairline px-3 py-[9px] last:border-b-0">
      <div className="flex items-start gap-2.5">
        <span className={`shrink-0 font-mono text-[11.5px] text-hint ${props.repos.length > 1 ? '' : 'w-[46px]'}`}>{exampleRef(example.prKey, props.repos)}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[12.5px] font-semibold text-ink [overflow-wrap:anywhere]">{example.title}</span>
          <span className="text-xs text-ink-2">{example.reason}</span>
        </span>
        <span className="flex shrink-0 gap-1">
          <LabelButton kind="want" picked={entry?.label === 'want'} title={wantTitle} onClick={() => props.onLabels(toggleLabel(labels, example.prKey, 'want'))} />
          <LabelButton kind="noise" picked={entry?.label === 'noise'} title={noiseTitle} onClick={() => props.onLabels(toggleLabel(labels, example.prKey, 'noise'))} />
        </span>
      </div>
      {entry && (
        <input
          aria-label={`Why ${LABEL_WORDS[entry.label]} for ${exampleRef(example.prKey, props.repos)}`}
          value={entry.why}
          maxLength={200}
          placeholder="Why? (optional, the tightening goes by it)"
          onChange={(event) => props.onLabels(setLabelWhy(labels, example.prKey, event.target.value))}
          className={`rounded-row border border-control bg-surface px-2 py-1 text-xs text-ink outline-none select-text placeholder:text-faint focus:border-accent ${props.repos.length > 1 ? '' : 'ml-[56px]'}`}
        />
      )}
    </li>
  );
}

function ExampleList(props: { examples: ScoutTrialExample[]; repos: string[]; nearMiss: boolean; labels: ScoutLabels; onLabels: (labels: ScoutLabels) => void }) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-[10px] inset-ring inset-ring-edge-hairline">
      {props.examples.map((example) => (
        <ExampleRow key={example.prKey} example={example} repos={props.repos} nearMiss={props.nearMiss} labels={props.labels} onLabels={props.onLabels} />
      ))}
    </ul>
  );
}

/** The changed words of one version's prompt, "…" where unchanged text was left out; the whole prompt on hover. */
function PromptWords(props: { part: PromptPart | null; whole: string; muted: boolean }) {
  if (props.part === null) {
    return <span className="text-xs text-hint">Prompt unchanged</span>;
  }
  const { text, cutStart, cutEnd } = props.part;
  // Words only added (or only taken out): that side has nothing of its own to show.
  if (text === '') {
    return null;
  }
  return (
    <span title={props.whole} className={`text-xs leading-[1.45] ${props.muted ? 'text-hint' : 'text-ink-2'}`}>
      {cutStart && '… '}
      <span className={props.muted ? 'line-through' : 'font-medium text-ink'}>{text}</span>
      {cutEnd && ' …'}
    </span>
  );
}

/** One version's prompt change and path hints, the hints marked as the change made them. */
function VersionLines(props: { label: string; version: ScoutVersion; part: PromptPart | null; hints: { hint: string; change: 'kept' | 'added' | 'removed' }[]; muted: boolean }) {
  return (
    <>
      <span className="pt-px text-[11px] font-semibold text-hint">{props.label}</span>
      <span className="flex min-w-0 flex-col gap-1">
        <PromptWords part={props.part} whole={props.version.prompt} muted={props.muted} />
        <span className="flex flex-wrap gap-1">
          {props.hints.length === 0 && <span className="text-[11.5px] text-hint">No path hints</span>}
          {props.hints.map(({ hint, change }) => (
            <span key={hint} className={`rounded-[5px] bg-surface px-1.5 py-px font-mono text-[11px] inset-ring inset-ring-edge-hairline ${HINT_LOOKS[change]}`}>
              {hint}
            </span>
          ))}
        </span>
      </span>
    </>
  );
}

/** After "Tighten": the counts, what changed, the prompt and hints before and after, any wanted PR lost, and Undo. */
function TightenedBox(props: { previous: ScoutVersion; current: ScoutVersion; repos: string[]; onUndo: () => void; busy: boolean }) {
  const { previous, current } = props;
  const tightening = current.tightening!;
  const change = pathsChange(previous.paths, current.paths);
  const lost = lostWantsText(tightening.lostWants, props.repos);
  const prompt = promptChange(previous.prompt, current.prompt);
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] bg-subtle px-3 py-2.5 inset-ring inset-ring-edge-hairline">
      <span className="text-[12.5px] leading-[1.45] text-ink">
        <strong className="font-semibold">{tightenedHeading(previous.trial, current.trial)}</strong> {tightening.summary}
      </span>
      {tightening.droppedHints > 0 && (
        <span className="text-[11.5px] text-hint">{plural(tightening.droppedHints, 'suggested path hint')} could not go into scouts.md and stayed out.</span>
      )}
      <div className="grid grid-cols-[44px_1fr] gap-x-2.5 gap-y-2">
        <VersionLines label="Before" version={previous} part={prompt?.removed ?? null} hints={change.filter((entry) => entry.change !== 'added')} muted />
        <VersionLines label="After" version={current} part={prompt?.added ?? null} hints={change.filter((entry) => entry.change !== 'removed')} muted={false} />
      </div>
      {lost && (
        <div className="rounded-[8px] bg-amber-soft px-2.5 py-2 text-[12.5px] leading-[1.45] text-amber-ink">
          <strong className="font-semibold">{lost}.</strong> The tighter version no longer pulls it; undo to go back one step.
        </div>
      )}
      <span>
        <Button size="sm" disabled={props.busy} onClick={props.onUndo}>
          Undo this tightening
        </Button>
      </span>
    </div>
  );
}

/**
 * The dry run on the check screen (DESIGN.md "Scouts" › The intro card):
 * up to 8 pulled examples and 3 near misses to mark Want or Noise, with an
 * optional why; "Tighten" once 3 are marked; after a tightening, what
 * changed with Undo. Labels and versions are the card's state, never
 * stored.
 */
export function ScoutTrialSection(props: {
  versions: ScoutVersion[];
  repos: string[];
  labels: ScoutLabels;
  onLabels: (labels: ScoutLabels) => void;
  onTighten: () => void;
  onUndo: () => void;
  tightening: boolean;
  tightenError: string | null;
}) {
  const agentOff = useAgentOffReason();
  const current = currentVersion(props.versions);
  const previous = previousVersion(props.versions);
  const { trial } = current;
  const note = trialNote(trial);
  const examples = trial?.examples ?? [];
  const nearMisses = trial?.nearMisses ?? [];
  const blocked = tightenBlockedReason({ labels: props.labels, trial, agentOff });
  const canLabel = examples.length + nearMisses.length > 0 || labelCount(props.labels) > 0;
  return (
    <div className="flex flex-col gap-2">
      {previous && current.tightening && <TightenedBox previous={previous} current={current} repos={props.repos} onUndo={props.onUndo} busy={props.tightening} />}
      {trial && !trialSkipped(trial) && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs font-semibold text-ink">{trialHeading(trial)}</span>
          {examples.length > 0 && <span className="text-[11.5px] text-hint">for example · worth your time?</span>}
        </div>
      )}
      {examples.length > 0 && <ExampleList examples={examples} repos={props.repos} nearMiss={false} labels={props.labels} onLabels={props.onLabels} />}
      {nearMisses.length > 0 && (
        <>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold text-ink">Near misses</span>
            <span className="text-[11.5px] text-hint">a path matched, the scout skipped them</span>
          </div>
          <ExampleList examples={nearMisses} repos={props.repos} nearMiss labels={props.labels} onLabels={props.onLabels} />
        </>
      )}
      {note && <p className="text-[11.5px] leading-normal text-hint">{note}</p>}
      {props.tightenError && <p className="rounded-[10px] bg-subtle px-3 py-2.5 text-[12.5px] leading-[1.45] text-ink-2 inset-ring inset-ring-edge-hairline">{props.tightenError}</p>}
      {canLabel && (
        <div className="flex items-center gap-2.5">
          <span className="flex-1 text-[11.5px] leading-normal text-hint">{props.tightening ? 'Tightening… one agent call, then the dry run again on the same PRs.' : tightenHint(props.labels)}</span>
          <Button size="sm" disabled={props.tightening || blocked !== null} title={blocked ?? undefined} onClick={props.onTighten}>
            {props.tightening ? 'Tightening…' : 'Tighten'}
          </Button>
        </div>
      )}
    </div>
  );
}
