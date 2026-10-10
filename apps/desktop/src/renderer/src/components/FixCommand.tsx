import { useState } from 'react';

/**
 * The exact command to run, with a copy button. Copying is local; nothing
 * runs from here. Used by setup's checks and the missing-tool note.
 */
export function FixCommand(props: { command: string; label?: string | null }) {
  const [copied, setCopied] = useState(false);
  const label = props.label === undefined ? 'Run in a terminal:' : props.label;
  async function copy() {
    try {
      await navigator.clipboard.writeText(props.command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No clipboard (plain web page without permission): the command stays selectable.
    }
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      {label && <span className="shrink-0 text-[11.5px] text-muted">{label}</span>}
      <code className="min-w-0 break-all rounded-control border border-hairline bg-subtle px-2 py-0.5 font-mono text-[11px] text-ink select-text" title={props.command}>
        {props.command}
      </code>
      <button type="button" onClick={() => void copy()} className="shrink-0 text-[11px] text-faint hover:text-ink-2 hover:underline">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
