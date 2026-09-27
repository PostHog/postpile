import { useState } from 'react';

/** "Open in editor" reveals where the file lives, so a hand edit is one copy away. The app never opens it itself. */
export function InstructionsFileLine(props: { path: string | null }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  if (props.path === null) {
    return <span className="text-[11.5px] text-faint">Sample data: kept in memory, no file is written.</span>;
  }
  const path = props.path;

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable; the path is selectable text anyway.
    }
  }

  if (!shown) {
    return (
      <button type="button" onClick={() => setShown(true)} className="self-start text-[11.5px] text-accent hover:underline">
        Open in editor
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-[11.5px] text-muted">
      <span>Edit by hand at</span>
      <code className="rounded bg-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-ink select-all">{path}</code>
      <button type="button" onClick={() => void copy()} className="text-accent hover:underline">
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="text-faint">Hand edits are kept as their own version.</span>
    </span>
  );
}
