import type { SetupCheck } from '@postpile/core';
import { useSetupChecks } from '../api/setup.ts';
import { CHECK_CHIPS } from '../lib/setup.ts';
import { Button } from './Button.tsx';
import { FixCommand } from './FixCommand.tsx';
import { SetupChip } from './SetupChip.tsx';

function CheckRow(props: { check: SetupCheck }) {
  const { check } = props;
  const chip = CHECK_CHIPS[check.state];
  return (
    <li className="grid grid-cols-[76px_minmax(0,1fr)] items-start gap-3 border-t border-hairline-soft py-3 first:border-t-0">
      <SetupChip tone={chip.tone} word={chip.word} />
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-medium text-ink">{check.label}</span>
        <span className="text-xs text-ink-2 select-text">{check.detail}</span>
        {check.fix && check.state !== 'ok' && <FixCommand command={check.fix} />}
      </div>
    </li>
  );
}

/**
 * Step 1: gh installed and logged in, notifications readable, claude found.
 * Continue only once gh works; a missing claude is a warning. "Check again"
 * reruns the checks after the user fixed something in a terminal.
 */
export function SetupChecksStep(props: { onContinue: () => void; onSkip: () => void; skipLabel: string }) {
  const checks = useSetupChecks(true);
  const view = checks.data;
  const checking = checks.isFetching;
  const blocked = !view?.canContinue;
  return (
    <section className="flex max-w-[760px] flex-col gap-3 rounded-tile bg-surface p-4 shadow-tile">
      <div className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold text-ink">Check the basics</h2>
        <p className="text-xs text-ink-2">PostPile reads GitHub through the GitHub CLI and runs its agent through the Claude Code CLI. Nothing is changed here.</p>
      </div>
      {checks.error && <p className="text-xs text-status-bad">Could not run the checks: {checks.error.message}</p>}
      {!view && !checks.error && <p className="py-3 text-xs text-muted">Checking gh, your GitHub login and claude…</p>}
      {view && (
        <ul className="flex flex-col">
          {view.checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </ul>
      )}
      {view && !view.agentAvailable && view.canContinue && (
        <p className="rounded-row bg-amber-soft px-3 py-2 text-xs text-amber-ink">
          Without claude there is no agent: no draft in the next steps, and no topics, dossiers or glances later. You can still continue and write your
          instructions yourself.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Button
          variant="primary"
          disabled={blocked || checking}
          title={blocked ? 'gh needs to be installed, logged in and able to read notifications first' : undefined}
          onClick={props.onContinue}
        >
          Continue
        </Button>
        <Button disabled={checking} onClick={() => void checks.refetch()}>
          {checking ? 'Checking…' : 'Check again'}
        </Button>
        <Button className="ml-auto" onClick={props.onSkip}>
          {props.skipLabel}
        </Button>
      </div>
    </section>
  );
}
