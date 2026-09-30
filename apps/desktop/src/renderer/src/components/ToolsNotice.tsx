import { useState } from 'react';
import type { ToolFix, ToolsView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useTools } from '../api/tools.ts';
import { checkLine, retryLine, toolsNotice } from '../lib/tools.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';
import { FixCommand } from './FixCommand.tsx';
import { SetupChip } from './SetupChip.tsx';

/** The fix as numbered steps: what to do, then the exact command. */
function FixSteps(props: { fixes: ToolFix[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {props.fixes.map((fix, index) => (
        <li key={fix.label} className="grid grid-cols-[18px_128px_minmax(0,1fr)] items-center gap-1">
          <span className="font-mono text-[11px] text-faint">{index + 1}.</span>
          <span className="text-xs text-ink-2">{fix.label}</span>
          {fix.command ? <FixCommand command={fix.command} label={null} /> : <span />}
        </li>
      ))}
    </ol>
  );
}

function CheckAgain(props: { view: ToolsView; primary?: boolean }) {
  const actions = useActions();
  const now = useNow(15_000);
  const checking = actions.isBusy('tools:check');
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button variant={props.primary ? 'primary' : 'secondary'} disabled={checking} onClick={() => void actions.checkTools()}>
        {checking ? 'Checking…' : 'Check again'}
      </Button>
      <span className="text-[11px] text-hint">{checkLine(props.view, now)}</span>
    </div>
  );
}

/**
 * gh is missing, logged out or refused: nothing can sync. `empty` is the
 * middle column's empty state on a first run; `banner` sits above the
 * topics the app already has.
 */
function GhNote(props: { view: ToolsView; place: 'empty' | 'banner' }) {
  const gh = props.view.gh;
  const claude = toolsNotice(props.view).claude;
  const frame = props.place === 'empty' ? 'm-auto w-full max-w-[560px] p-5' : 'px-4 py-3';
  return (
    <section className={`flex flex-col gap-3 rounded-tile bg-surface shadow-tile ${frame}`}>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <SetupChip tone="bad" word="Fix this" />
          <h2 className="text-[14px] font-semibold text-ink">{gh.headline}</h2>
        </div>
        <p className="text-xs leading-relaxed text-ink-2">{gh.detail}</p>
      </div>
      <FixSteps fixes={gh.fixes} />
      {claude && (
        <div className="flex flex-col gap-1.5 border-t border-hairline-soft pt-3">
          <p className="text-xs font-medium text-ink">{claude.headline}</p>
          <p className="text-xs text-ink-2">{claude.detail}</p>
          {claude.fixes.length > 0 && <FixSteps fixes={claude.fixes} />}
        </div>
      )}
      <CheckAgain view={props.view} primary={props.place === 'empty'} />
    </section>
  );
}

/**
 * The agent is off (claude missing or logged out) or paused (usage limit).
 * One quiet line that says so plainly; the fix folds out.
 */
function ClaudeStrip(props: { view: ToolsView }) {
  const [open, setOpen] = useState(false);
  const now = useNow(30_000);
  const claude = props.view.claude;
  const limited = claude.state === 'limited';
  const summary = limited ? retryLine(claude.retryAt, now) : 'Tiles, whose turn and notifications run on rules.';
  return (
    <section className="flex flex-col gap-2.5 rounded-tile border border-hairline bg-surface px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <SetupChip tone="warn" word={limited ? 'Paused' : 'Rules only'} />
        <p className="min-w-0 text-xs leading-snug text-ink-2" title={claude.detail}>
          <span className="font-medium text-ink">{claude.headline}.</span> {summary}
        </p>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="ml-auto shrink-0 text-[11.5px] text-muted hover:text-ink hover:underline"
        >
          {open ? 'Hide' : limited ? 'Details' : 'How to fix'}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-2.5 border-t border-hairline-soft pt-2.5">
          <p className="text-xs text-ink-2">{claude.detail}</p>
          {claude.fixes.length > 0 && <FixSteps fixes={claude.fixes} />}
          <CheckAgain view={props.view} />
        </div>
      )}
    </section>
  );
}

/**
 * What PostPile says when gh or claude cannot be used (DESIGN.md "Missing
 * tools"). Renders nothing while both work or before the status loaded.
 * `empty`: the gh note as the middle column's empty state. `banner`: above
 * the topics, the gh note or else the claude line.
 */
export function ToolsNotice(props: { place: 'empty' | 'banner' }) {
  const view = useTools().data;
  const notice = toolsNotice(view);
  if (!view) {
    return null;
  }
  if (notice.gh) {
    return <GhNote view={view} place={props.place} />;
  }
  if (notice.claude && props.place === 'banner') {
    return <ClaudeStrip view={view} />;
  }
  return null;
}
