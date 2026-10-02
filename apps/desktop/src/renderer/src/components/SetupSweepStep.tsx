import type { SetupSweepView } from '@postpile/core';
import { LINE_CHIPS } from '../lib/setup.ts';
import { elapsedLabel } from '../lib/sync-progress.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';
import { SetupChip } from './SetupChip.tsx';
import { TeamRolesList } from './TeamRolesList.tsx';

const STEP_WORDS: Record<SetupSweepView['lines'][number]['step'], string> = {
  viewer: 'You and your teams',
  teams: 'Home team',
  activity: 'Your last 30 days',
  codeowners: 'Ownership files',
  digest: 'Work context',
  draft: 'Draft',
};

/**
 * Step 2: the sweep's live progress lines while it runs (GitHub reads, then
 * one agent call), then Continue. A failed draft still continues, with a
 * blank template; a failed profile read can only be run again.
 */
export function SetupSweepStep(props: {
  view: SetupSweepView | null | undefined;
  starting: boolean;
  onContinue: () => void;
  onRunAgain: () => void;
  onBack: () => void;
}) {
  const now = useNow(1000);
  const view = props.view;
  const running = props.starting || (view?.running ?? true);
  const finished = view !== null && view !== undefined && !view.running;
  const blank = finished && view.draft !== null && view.draft.model === null;
  return (
    <section className="flex max-w-[760px] flex-col gap-3 rounded-tile bg-surface p-4 shadow-tile">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Sweep</h2>
        {view && <span className="font-mono text-[10.5px] text-faint">{elapsedLabel(view.startedAt, view.finishedAt ? new Date(view.finishedAt) : now)}</span>}
      </div>
      <p className="text-xs text-ink-2">
        Reads your GitHub profile, teams, who was asked on the PRs you reviewed in the last 90 days (to tell your home team), the PRs you wrote, reviewed or
        were asked to review in the last 30 days (titles and folders only), and the CODEOWNERS and owners.yaml rules that name you or your teams. Then one
        agent call writes a draft. GitHub is only read.
      </p>
      <ul className="flex flex-col">
        {(view?.lines ?? []).map((line, index) => {
          const chip = LINE_CHIPS[line.state];
          return (
            <li key={`${line.step}-${index}`} className="grid grid-cols-[76px_128px_minmax(0,1fr)] items-baseline gap-3 border-t border-hairline-soft py-2 first:border-t-0">
              <SetupChip tone={chip.tone} word={chip.word} />
              <span className="text-xs font-medium text-ink">{STEP_WORDS[line.step]}</span>
              <span className={`text-xs select-text ${line.state === 'failed' ? 'text-status-bad' : line.state === 'running' ? 'text-muted' : 'text-ink-2'}`}>{line.text}</span>
            </li>
          );
        })}
        {!view && <li className="py-2 text-xs text-muted">Starting the sweep…</li>}
      </ul>
      {finished && view.teamRoles && view.teamRoles.teams.length > 0 && (
        <div className="flex flex-col gap-1 rounded-row bg-subtle px-3 py-2">
          <p className="text-[11.5px] text-muted">
            A home team's members are your teammates. A routing-only team just brings you its review requests and mentions. Change it if the sweep got it
            wrong; later you find it under Your instructions.
          </p>
          <TeamRolesList teams={view.teamRoles.teams} />
        </div>
      )}
      {finished && view.error && !view.draft && <p className="rounded-row bg-status-bad-soft px-3 py-2 text-xs text-status-bad">{view.error}</p>}
      {blank && (
        <p className="rounded-row bg-amber-soft px-3 py-2 text-xs text-amber-ink">
          No agent draft this time. You can continue with a blank template and write it yourself, or run the sweep again.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Button variant="primary" disabled={!finished || !view.draft} onClick={props.onContinue}>
          {blank ? 'Continue with a blank draft' : 'Continue to the draft'}
        </Button>
        <Button disabled={running} onClick={props.onRunAgain}>
          Run again
        </Button>
        <Button className="ml-auto" onClick={props.onBack}>
          Back
        </Button>
      </div>
    </section>
  );
}
