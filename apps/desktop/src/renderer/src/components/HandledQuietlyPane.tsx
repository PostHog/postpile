import type { QuietReadView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useHandledQuietly } from '../api/quiet.ts';
import { quietReasonText, quietRef } from '../lib/quiet.ts';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import type { TilePick } from './NotificationRow.tsx';

/** One quiet mark-read. A click opens its tile when one holds the PR; nothing is marked read or unread. */
function QuietRow(props: { item: QuietReadView; now: Date; onOpenTile: (pick: TilePick) => void }) {
  const { item, now } = props;
  const landing = item.landing;
  const canOpen = landing.kind === 'tile';
  return (
    <li className="border-t border-hairline-soft first:border-t-0">
      <button
        type="button"
        disabled={!canOpen}
        onClick={() => landing.kind === 'tile' && props.onOpenTile({ topicId: landing.topicId, tileId: landing.tileId, prKey: item.prKey })}
        title={canOpen ? 'Open its tile' : 'No tile shows this PR right now'}
        className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_52px] items-center gap-3 px-3 py-2 text-left enabled:hover:bg-subtle disabled:cursor-default"
      >
        <span className="flex min-w-0 flex-col">
          <span className="font-mono text-[10.5px] text-muted">{quietRef(item)}</span>
          <span className="truncate text-[12.5px] text-ink-2" title={item.title}>
            {item.title}
          </span>
        </span>
        <span className="truncate text-[11.5px] text-muted" title={item.reason === 'bots' || item.reason === 'judged' ? item.bots.join(', ') : quietReasonText(item)}>
          {quietReasonText(item)}
        </span>
        <span className="text-right font-mono text-[10.5px] text-faint" title={item.at}>
          {ageLabel(item.at, now)}
        </span>
      </button>
    </li>
  );
}

/**
 * "Handled quietly": PR threads PostPile marked read on GitHub by itself in
 * the last 7 days: only bots acted since the user's last read, the user
 * reviewed or replied after everything unread, or they opened the PR here
 * while nothing was asked of them. Read only, quiet on purpose: no counts in
 * coral, no actions besides opening the tile (GitHub has no mark-unread).
 */
export function HandledQuietlyPane(props: { onOpenTile: (pick: TilePick) => void }) {
  const quiet = useHandledQuietly();
  const writes = useActions().writes;
  const now = useNow();
  const items = quiet.data ?? [];
  return (
    <main className="pane-scroll col-span-2 flex min-w-0 flex-col gap-[18px] overflow-auto pl-[26px] pr-[16px] py-[22px]">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[23px] leading-tight font-[650] tracking-[-0.022em]">Handled quietly</h1>
        <p className="max-w-[720px] text-[13px] text-ink-2">
          PR threads PostPile marked read on GitHub for you, only while GitHub writes are unlocked. After a full sync: threads you had read that came back
          only because of bots (CI, merge queues, review and deploy bots; never while something is your move or new for you),
          threads where you reviewed or replied after everything unread, from the gh CLI, GitHub Mobile or an agent, and threads where everything since
          you last looked is bots or people the agent judged as not needing you. And PRs you opened here while nothing was asked of you. Never a review
          request, mention, question or reply to you, and never a merge without your review. Releases and issues are marked read too, and not listed.
        </p>
      </div>
      {writes && !writes.enabled && (
        <p className="max-w-[720px] rounded-row bg-subtle px-3 py-2 text-[12px] text-ink-2">GitHub writes are locked, so nothing is handled quietly right now.</p>
      )}
      {quiet.error && <p className="text-xs text-status-bad">Could not load the list: {quiet.error.message}</p>}
      {quiet.isPending && <p className="text-xs text-muted">Loading…</p>}
      {!quiet.isPending && !quiet.error && items.length === 0 && (
        <p className="rounded-tile border border-dashed border-frame px-4 py-8 text-center text-xs text-muted">Nothing handled quietly in the last 7 days.</p>
      )}
      {items.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[13px] font-semibold">Last 7 days</h2>
            <span className="font-mono text-[10.5px] text-faint">{items.length}</span>
          </div>
          <ul className="flex shrink-0 flex-col overflow-hidden rounded-tile bg-surface shadow-tile">
            <li
              aria-hidden="true"
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_52px] gap-3 border-b border-hairline bg-subtle px-3 py-1.5 text-[10.5px] font-medium text-faint"
            >
              <span>PR</span>
              <span>Why</span>
              <span className="text-right">Marked</span>
            </li>
            {items.map((item) => (
              <QuietRow key={item.id} item={item} now={now} onOpenTile={props.onOpenTile} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
