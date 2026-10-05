import type { KeyFile, PrPaneView } from '@postpile/core';
import { filesTabUrl, keyFileRows } from '../lib/key-files.ts';
import { FileIcon } from './icons.tsx';
import { SectionLabel } from './SectionLabel.tsx';

/**
 * The agent's "Look at first": up to three changed files a reviewer should
 * open first, with why and their +/- counts. Each opens the PR's files tab
 * on GitHub. Nothing when the glance names none (trivial PRs, old glances).
 */
export function KeyFiles(props: { keyFiles: KeyFile[]; pr: PrPaneView }) {
  if (props.keyFiles.length === 0) {
    return null;
  }
  const href = filesTabUrl(props.pr.url);
  return (
    <div className="flex flex-col gap-[3px]">
      <span className="px-3">
        <SectionLabel>Look at first</SectionLabel>
      </span>
      {/* Rows run edge to edge at 22px; icons on the 34px line, paths on 62. */}
      <div className="flex flex-col pt-0.5">
        {keyFileRows(props.keyFiles, props.pr).map((row) => (
          <a
            key={row.path}
            href={href}
            target="_blank"
            rel="noreferrer"
            title={`${row.path}\nOpens the PR's files on GitHub`}
            className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-px rounded-[7px] px-3 py-1 hover:bg-subtle"
          >
            <FileIcon className="justify-self-center text-faint" />
            <span className="truncate font-mono text-[11.5px] text-ink">{row.shortPath}</span>
            {row.additions !== null && row.deletions !== null ? (
              // A fixed-width, right-aligned column with a true minus sign; a zero deletion is ghosted.
              <span className="flex min-w-16 justify-end gap-[5px] font-mono text-[10.5px] tabular-nums">
                <span className="text-open">+{row.additions}</span>
                <span className={row.deletions === 0 ? 'text-ghost' : 'text-diff-red'}>−{row.deletions}</span>
              </span>
            ) : (
              <span />
            )}
            {row.why && <span className="col-start-2 col-end-4 text-[12px] leading-[1.4] text-hint">{row.why}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}
