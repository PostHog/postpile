import { useCallback, useRef, useState } from 'react';
import { useActions } from '../api/actions.tsx';
import { useMcpConnection } from '../api/mcp.ts';
import { mcpFooterShows } from '../lib/mcp.ts';
import { useDismiss } from '../lib/use-dismiss.ts';
import { McpConnectOffer } from './McpConnectOffer.tsx';

/**
 * "agents: not connected" in the status footer while Claude Code lacks
 * PostPile's MCP server. A click opens the offer; "Not now" hides the item
 * for good (the server keeps it). Gone once connected, and never shown while
 * the state is unknown (dev build, claude missing or logged out).
 */
export function McpFooterItem() {
  const view = useMcpConnection().data;
  const actions = useActions();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);

  if (!view || !mcpFooterShows(view)) {
    return null;
  }
  async function notNow() {
    setOpen(false);
    await actions.hideMcpConnect();
  }
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Let Claude Code and other agents ask PostPile about a PR"
        onClick={() => setOpen(!open)}
        className="rounded px-1 text-muted hover:bg-subtle hover:text-ink"
      >
        agents: not connected
      </button>
      {open && (
        <div role="dialog" aria-label="Connect other agents" className="absolute bottom-full left-0 z-20 mb-1.5 flex w-80 flex-col gap-2 rounded-row bg-surface p-3 font-sans whitespace-normal shadow-menu">
          <span className="text-[12.5px] font-semibold text-ink">Let other agents ask PostPile</span>
          <McpConnectOffer view={view} from="footer" onNotNow={() => void notNow()} />
        </div>
      )}
    </div>
  );
}
