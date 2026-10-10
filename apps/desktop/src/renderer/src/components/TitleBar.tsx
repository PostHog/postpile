import type { ReactNode } from 'react';
import type { LivePollStatus, SyncProgress, SyncReport } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useLiveStatus } from '../api/live.ts';
import { useSyncProgress } from '../api/sync.ts';
import { useTools } from '../api/tools.ts';
import { capNote } from '../lib/agent-stats.ts';
import { pollIsFresh } from '../lib/live.ts';
import { syncProgressDetail, syncProgressText } from '../lib/sync-progress.ts';
import { syncReportDetail } from '../lib/sync-report.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import logoUrl from '../assets/logo-64.png';
import { BackIcon, ForwardIcon, SyncIcon } from './icons.tsx';
import { UpdatePill } from './UpdatePill.tsx';

/** The status dot with a halo at 16% of its own color. */
const DOTS = {
  accent: 'bg-accent ring-accent/16',
  amber: 'bg-amber ring-amber/16',
  quiet: 'bg-dot-quiet ring-dot-quiet/16',
  bad: 'bg-status-bad ring-status-bad/16',
  open: 'bg-open ring-open/16',
};

type DotTone = keyof typeof DOTS;

/** Numbers in the status line are mono and ink; the words around them stay quiet. */
function Num(props: { children: ReactNode }) {
  return <span className="font-mono text-[10.5px] font-semibold text-ink-2 tabular-nums">{props.children}</span>;
}

function Sep() {
  return <span className="text-ghost">·</span>;
}

function StatusText(props: { dot: DotTone; detail: string; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] whitespace-nowrap text-hint" title={props.detail}>
      <span className={`size-1.5 shrink-0 rounded-full ring-2 ${DOTS[props.dot]}`} />
      <span className="flex min-w-0 items-center gap-1.5 truncate">{props.children}</span>
    </span>
  );
}

/** "syncing · agent 34/82 · 2m". Its own component so only it ticks every second, and only while a sync runs. */
function SyncProgressStatus(props: { progress: SyncProgress | null | undefined }) {
  const now = useNow(1000);
  return (
    <StatusText dot="accent" detail={syncProgressDetail(props.progress)}>
      <span className="font-mono text-[10.5px]">{syncProgressText(props.progress, now)}</span>
    </StatusText>
  );
}

/** "now" or "12m ago", for the sync status tooltip. */
function agoWords(iso: string, now: Date): string {
  const age = ageLabel(iso, now);
  return age === 'now' ? 'just now' : `${age} ago`;
}

/**
 * The sync status tooltip: the live poll keeps the data current, the full
 * sync is the slower sweep behind it, with its whole report.
 */
function freshnessDetail(live: LivePollStatus | undefined, report: SyncReport, now: Date): string {
  let poll = 'Live poll off: data is as fresh as the last full sync.';
  if (live && live.state !== 'off') {
    const note = live.note ? ` Now: ${live.note}.` : '';
    poll = live.lastAnsweredAt
      ? `Live poll: GitHub answered ${agoWords(live.lastAnsweredAt, now)}, every ${live.githubQuota?.pollSeconds ?? live.everySeconds}s.${note}`
      : `Live poll: waiting for its first check.${note}`;
  }
  const sweep = `Last full sync ${agoWords(report.finishedAt, now)}. It sweeps the last 30 days, groups sets and stacks, folds quiet news (bots, CI) into dossiers and retires finished topics.`;
  return `${poll}\n\n${sweep}\n${syncReportDetail(report)}`;
}

/**
 * The live poll checks GitHub every minute, so the headline is "up to date"
 * while it keeps up, and an age only once it fell behind or is off. The
 * full sync's time and counts live in the tooltip and the footer.
 */
function SyncStatus() {
  const actions = useActions();
  const now = useNow();
  const progress = useSyncProgress(actions.syncing).data;
  const tools = useTools().data;
  const live = useLiveStatus().data;
  if (actions.syncing) {
    return <SyncProgressStatus progress={progress} />;
  }
  if (tools && !tools.canSync) {
    return (
      <StatusText dot="amber" detail={`${tools.gh.headline}. The note in the middle column has the fix.`}>
        sync off <Sep /> gh needs a fix
      </StatusText>
    );
  }
  const report = actions.lastSync;
  if (report?.heldForCatchUp) {
    return (
      <StatusText dot="amber" detail={`The first sync fetched ${report.prsFetched} PRs and waits for the inbox question before the agent work.`}>
        waiting for your answer
      </StatusText>
    );
  }
  if (!report) {
    return (
      <StatusText dot="quiet" detail="not synced yet">
        not synced yet
      </StatusText>
    );
  }
  const capped = capNote(report.agentCallStats, actions.config?.autoSyncMinutes ?? 0);
  const errors = report.errors.length;
  const pollOn = live !== undefined && live.state !== 'off';
  const fresh = pollIsFresh(live, now);
  // With the poll off nothing else notices that GitHub cannot be reached; with it on, its backoff says "updates paused".
  const unreachable = !pollOn && tools?.gh.state === 'offline';
  const paused = live !== undefined && (live.state === 'blocked' || live.state === 'backoff');
  // Before its first answer the poll is starting, not behind: no amber.
  const behind = pollOn && live.lastAnsweredAt !== null && !fresh;
  let dot: DotTone = 'open';
  if (paused || behind || unreachable) {
    dot = 'amber';
  }
  if (capped) {
    dot = 'amber';
  }
  if (errors > 0) {
    dot = 'bad';
  }
  // A stale poll still counts from its last check; without a poll the full sync is the only clock.
  const lastAnsweredAt = pollOn ? live.lastAnsweredAt : null;
  const word = lastAnsweredAt ? 'checked' : 'synced';
  const age = ageLabel(lastAnsweredAt ?? report.finishedAt, now);
  let headline: ReactNode;
  if (unreachable) {
    headline = 'GitHub unreachable';
  } else if (fresh) {
    headline = 'up to date';
  } else if (paused) {
    // The footer and the tooltip say why: backing off, catching up, consolidating.
    headline = 'updates paused';
  } else if (age === 'now') {
    headline = `${word} just now`;
  } else {
    headline = (
      <>
        {word} <Num>{age}</Num> ago
      </>
    );
  }
  return (
    <StatusText dot={dot} detail={freshnessDetail(live, report, now)}>
      <span>{headline}</span>
      {errors > 0 && (
        <>
          <Sep />
          <span>
            <Num>{errors}</Num> sync {errors === 1 ? 'error' : 'errors'}
          </span>
        </>
      )}
      {capped && (
        <>
          <Sep />
          <span>{capped}</span>
        </>
      )}
    </StatusText>
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
  /** The search field, centered in the bar. */
  search: ReactNode;
  /** The repo filter, first in the right column (the left one clips popovers). */
  repoScope: ReactNode;
}

/**
 * 52px bar that drags the window. The left 88px (16px padding + 72px) stay
 * free for the traffic lights. Three columns, the outer two of equal width
 * and the padding symmetric, keep the search field centered on the window.
 */
/** Disabled, not hidden, while gh cannot be used; the title says why. */
function SyncButton() {
  const actions = useActions();
  const tools = useTools().data;
  const ghOff = tools && !tools.canSync ? tools.gh.headline : null;
  return (
    <button
      type="button"
      aria-label="Sync now"
      title={ghOff ? `Sync is off: ${ghOff}` : 'Sync now'}
      disabled={actions.syncing || ghOff !== null}
      onClick={() => void actions.sync()}
      className="flex h-7 w-[30px] shrink-0 items-center justify-center rounded-control bg-surface text-ink-2 shadow-control inset-ring inset-ring-edge-control-soft hover:bg-subtle disabled:opacity-60 disabled:hover:bg-surface"
    >
      <SyncIcon className={actions.syncing ? 'animate-spin' : ''} />
    </button>
  );
}

export function TitleBar(props: TitleBarProps) {
  const actions = useActions();
  return (
    <header className="drag-region grid h-[52px] shrink-0 grid-cols-[minmax(0,1fr)_minmax(220px,380px)_minmax(0,1fr)] items-center gap-4 bg-titlebar px-4 shadow-[inset_0_-1px_0_var(--hairline)]">
      <div className="flex min-w-0 items-center gap-3.5 overflow-hidden pl-[72px] whitespace-nowrap">
        <span className="flex items-center gap-2">
          <img src={logoUrl} alt="" width={20} height={20} className="shrink-0 rounded-[5px]" draggable={false} />
          {/* The name gives way below 1280px so the centered search keeps its width. */}
          <span className="text-[13.5px] font-[650] tracking-[-0.012em] max-xl:hidden">PostPile</span>
        </span>
        {actions.config?.profile === 'dev' && (
          <span
            className="flex h-[20px] shrink-0 items-center rounded-[5px] bg-ink px-1.5 font-mono text-[10px] font-semibold tracking-wide text-on-ink"
            title={`Dev profile: a separate database, not the real one.\n${actions.config.databasePath ?? 'sample data, no database'}`}
          >
            DEV
          </span>
        )}
        {actions.config?.fake && (
          <>
            <span className="h-[18px] w-px bg-frame" />
            <span
              className="flex h-[22px] shrink-0 items-center rounded-full border border-dashed border-frame px-2 text-[11px] text-muted"
              title="POSTPILE_FAKE=1: built-in sample data, nothing reaches GitHub"
            >
              Sample data
            </span>
          </>
        )}
        {/* Pushed to the end of the column, next to the search field. */}
        <span className="-mr-1.5 ml-auto flex items-center">
          <NavButton label="Back" shortcut="⌘[" disabled={!props.canBack} onClick={props.onBack}>
            <BackIcon />
          </NavButton>
          <NavButton label="Forward" shortcut="⌘]" disabled={!props.canForward} onClick={props.onForward}>
            <ForwardIcon />
          </NavButton>
        </span>
      </div>
      {props.search}
      <div className="flex min-w-0 items-center justify-end gap-3.5">
        <UpdatePill />
        {props.repoScope}
        <SyncStatus />
        <SyncButton />
      </div>
    </header>
  );
}
