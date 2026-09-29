import type { KeyFile, Pr } from '@postpile/core';
import { filesTabUrl, keyFileRows } from '../lib/key-files.ts';
import { FileIcon } from './icons.tsx';

/**
 * The agent's "Look at first": up to three changed files a reviewer should
 * open first, with why and their +/- counts. Each opens the PR's files tab
 * on GitHub. Nothing when the glance names none (trivial PRs, old glances).
 */
export function KeyFiles(props: { keyFiles: KeyFile[]; pr: Pr }) {
  if (props.keyFiles.length === 0) {
    return null;
  }
  const href = filesTabUrl(props.pr.url);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold tracking-[0.04em] text-muted">Look at first</span>
      <div className="flex flex-col">
        {keyFileRows(props.keyFiles, props.pr).map((row) => (
          <a
            key={row.path}
            href={href}
            target="_blank"
            rel="noreferrer"
            title={`${row.path}\nOpens the PR's files on GitHub`}
            className="-mx-1.5 grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-1.5 py-1 hover:bg-subtle"
          >
            <FileIcon className="text-muted" />
            <span className="truncate font-mono text-[11.5px] text-ink">{row.shortPath}</span>
            {row.additions !== null && row.deletions !== null ? (
              <span className="font-mono text-[11px]">
                <span className="text-open">+{row.additions}</span> <span className="text-closed">−{row.deletions}</span>
              </span>
            ) : (
              <span />
            )}
            {row.why && <span className="col-start-2 col-end-4 text-[12px] leading-[1.35] text-muted">{row.why}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}
