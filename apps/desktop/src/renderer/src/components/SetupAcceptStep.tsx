import { useState } from 'react';
import type { SetupCurrentInstructions, SetupSectionEdit } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { useMcpConnection } from '../api/mcp.ts';
import { useSyncProgress } from '../api/sync.ts';
import { acceptPlan, draftText } from '../lib/setup.ts';
import { syncProgressDetail, syncProgressText } from '../lib/sync-progress.ts';
import { useNow } from '../lib/use-now.ts';
import { Button } from './Button.tsx';
import { DiffView } from './DiffView.tsx';
import { McpConnectOffer } from './McpConnectOffer.tsx';
import { SetupChip } from './SetupChip.tsx';

type Phase = 'review' | 'syncing';

/** The first sync after Accept, with the same progress text as the title bar. */
function SyncingNote() {
  const actions = useActions();
  const progress = useSyncProgress(actions.syncing);
  const now = useNow(1000);
  return (
    <div className="flex items-center gap-2 rounded-row bg-accent-soft px-3 py-2" title={syncProgressDetail(progress.data)}>
      <SetupChip tone="busy" word="Syncing" />
      <span className="font-mono text-[11.5px] text-ink-2">{syncProgressText(progress.data, now)}</span>
      <span className="text-xs text-muted">Your topics open when it is done.</span>
    </div>
  );
}

/** The optional MCP offer: "Add to Claude Code" only runs from its button, never with Accept. */
function McpOfferBox() {
  const view = useMcpConnection().data;
  if (!view) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2 rounded-row border border-hairline p-3">
      <h3 className="text-[12.5px] font-semibold text-ink">Optional: let other agents ask PostPile</h3>
      {view.state === 'connected' ? (
        <p className="text-xs text-ink-2">Claude Code has it. New Claude Code sessions can ask PostPile about a PR and its topic.</p>
      ) : (
        <McpConnectOffer view={view} from="setup" />
      )}
    </div>
  );
}

/**
 * Step 4: what Accept does, the final text (as a diff against the current
 * file, or all new), then Accept: writes a new instructions version, quiet
 * repos, scope and the done flag, runs the first sync and hands over to the
 * topics. A file changed on disk meanwhile sends the user back to review.
 * Below it, the optional MCP offer (its own button, never part of Accept).
 */
export function SetupAcceptStep(props: {
  edits: SetupSectionEdit[];
  base: SetupCurrentInstructions;
  quiet: string[];
  mainRepo: string | null;
  onBaseChanged: (current: SetupCurrentInstructions) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const actions = useActions();
  const [phase, setPhase] = useState<Phase>('review');
  const text = draftText(props.edits);
  const changed = text !== props.base.text;
  const busy = actions.isBusy('setup:accept') || phase === 'syncing';

  async function accept() {
    const result = await actions.acceptSetup({ sections: props.edits, quietRepos: props.quiet, mainRepo: props.mainRepo, baseVersion: props.base.version });
    if (result?.current) {
      props.onBaseChanged(result.current);
      return;
    }
    if (result?.ok) {
      setPhase('syncing');
      await actions.sync();
      props.onDone();
    }
  }

  return (
    <section className="flex max-w-[760px] flex-col gap-3 rounded-tile border border-hairline bg-surface p-4 shadow-tile">
      <h2 className="text-[15px] font-semibold text-ink">Accept</h2>
      <ol className="flex list-decimal flex-col gap-1 pl-5 text-xs text-ink-2">
        {acceptPlan({ baseVersion: props.base.version, changed, quietRepos: props.quiet, mainRepo: props.mainRepo }).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
      <DiffView before={props.base.text} after={text} context={props.base.text.trim() === '' ? 1000 : 2} />
      {phase === 'syncing' && <SyncingNote />}
      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <Button variant="primary" disabled={busy} onClick={() => void accept()}>
          {phase === 'syncing' ? 'Accepted' : actions.isBusy('setup:accept') ? 'Saving…' : 'Accept and sync'}
        </Button>
        <Button disabled={busy} onClick={props.onBack}>
          Back to the draft
        </Button>
      </div>
      <McpOfferBox />
    </section>
  );
}
