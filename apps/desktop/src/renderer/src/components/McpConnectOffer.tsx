import type { McpConnectFrom, McpConnectionView } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { Button } from './Button.tsx';
import { FixCommand } from './FixCommand.tsx';

/**
 * What connecting does, "Add to Claude Code" (runs `claude mcp add` on the
 * server, only from this click), and the commands to copy: the add command
 * when the app cannot run it itself (a dev build, claude off), and the
 * server command for other agents. Shared by the footer popover and the
 * last setup step; only the footer passes `onNotNow`.
 */
export function McpConnectOffer(props: { view: McpConnectionView; from: McpConnectFrom; onNotNow?: () => void }) {
  const actions = useActions();
  const busy = actions.isBusy('mcp:connect');
  const blocked = props.view.blockedReason;
  // In setup, "Accept and sync" stays the one primary button on the screen.
  const variant = props.from === 'setup' ? 'secondary' : 'primary';
  return (
    <div className="flex flex-col gap-2.5">
      {/* whitespace-normal: the footer popover sits in a nowrap row. */}
      <p className="text-[12px] leading-snug whitespace-normal text-ink-2">
        Claude Code and other agents can ask PostPile what it knows about a PR and its topic. It never writes to GitHub. Agents can leave notes on PRs and suggest topic changes; you accept or clear them.
      </p>
      <div className="flex items-center gap-1.5">
        <Button variant={variant} disabled={busy || blocked !== null} title={blocked ?? `Runs ${props.view.addCommand}`} onClick={() => void actions.connectMcp(props.from)}>
          {busy ? 'Adding…' : 'Add to Claude Code'}
        </Button>
        {props.onNotNow && (
          <Button disabled={busy} title="Hide this from the footer. Setup still offers it." onClick={props.onNotNow}>
            Not now
          </Button>
        )}
      </div>
      {blocked !== null && <FixCommand command={props.view.addCommand} />}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">Other agents: add a stdio MCP server that runs</span>
        <FixCommand command={props.view.serverCommand} label={null} />
      </div>
    </div>
  );
}
