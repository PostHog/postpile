import type { ReactNode } from 'react';
import { useActions } from '../api/actions.tsx';
import { capNote } from '../lib/agent-stats.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { BackIcon, ForwardIcon, LogoIcon, SyncIcon } from './icons.tsx';

function SyncStatus() {
  const actions = useActions();
  const now = useNow();
  const report = actions.lastSync;
  let dot = 'bg-dot-quiet';
  let text = 'not synced yet';
  if (actions.syncing) {
    dot = 'bg-accent';
    text = 'syncing…';
  } else if (report) {
    dot = report.errors.length > 0 ? 'bg-unread' : 'bg-open';
    const age = ageLabel(report.finishedAt, now);
    const when = age === 'now' ? 'just now' : `${age} ago`;
    text = `synced ${when} · ${report.prsFetched} PRs fetched · ${report.newEvents} new events`;
    const capped = capNote(report.agentCallStats);
    if (capped) {
      dot = 'bg-closer';
      text = `${text} · ${capped}`;
    }
  }
  return (
    <span className="ml-auto flex items-center gap-2 font-mono text-[11px] text-muted">
      <span className={`size-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  );
}

function NavButton(props: { label: string; shortcut: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={`${props.label} (${props.shortcut})`}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex size-7 items-center justify-center rounded-control text-ink-2 hover:bg-subtle disabled:text-ghost disabled:hover:bg-transparent"
    >
      {props.children}
    </button>
  );
}

interface TitleBarProps {
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
}

/** 52px bar that drags the window. The left 88px stay free for the traffic lights. */
export function TitleBar(props: TitleBarProps) {
  const actions = useActions();
  return (
    <header className="drag-region flex h-[52px] shrink-0 items-center gap-3.5 border-b border-hairline-strong bg-titlebar pr-4 pl-[88px]">
      <span className="-ml-1.5 flex items-center">
        <NavButton label="Back" shortcut="⌘[" disabled={!props.canBack} onClick={props.onBack}>
          <BackIcon />
        </NavButton>
        <NavButton label="Forward" shortcut="⌘]" disabled={!props.canForward} onClick={props.onForward}>
          <ForwardIcon />
        </NavButton>
      </span>
      <span className="flex items-center gap-2">
        <LogoIcon />
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Code Manager</span>
      </span>
      {actions.config?.fake && (
        <>
          <span className="h-[18px] w-px bg-frame" />
          <span
            className="flex h-[22px] items-center rounded-full border border-dashed border-frame px-2 text-[11px] text-muted"
            title="CODE_MANAGER_FAKE=1: built-in sample data, nothing reaches GitHub"
          >
            Sample data
          </span>
        </>
      )}
      <SyncStatus />
      <button
        type="button"
        aria-label="Sync now"
        title="Sync now"
        disabled={actions.syncing}
        onClick={() => void actions.sync()}
        className="flex h-7 w-[30px] items-center justify-center rounded-control border border-control bg-surface text-ink-2 shadow-control hover:bg-subtle disabled:opacity-60"
      >
        <SyncIcon className={actions.syncing ? 'animate-spin' : ''} />
      </button>
    </header>
  );
}
