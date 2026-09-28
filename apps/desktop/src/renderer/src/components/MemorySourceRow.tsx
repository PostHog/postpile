import type { MemorySource } from '@postpile/core';
import { ageLabel } from '../lib/time.ts';
import { useNow } from '../lib/use-now.ts';
import { Avatar } from './Avatar.tsx';
import { ExternalIcon, QuoteIcon } from './icons.tsx';

/** One source in a "Why?" panel: who, what, when, a short quote and a link to GitHub. */
export function MemorySourceRow(props: { source: MemorySource }) {
  const now = useNow();
  const { source } = props;
  return (
    <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2 gap-y-0.5">
      {source.who ? (
        <Avatar login={source.who} size="sm" />
      ) : (
        <span className="flex size-[18px] items-center justify-center text-muted" title="Your own words">
          <QuoteIcon />
        </span>
      )}
      <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
        <span className={`min-w-0 truncate ${source.missing ? 'text-faint' : 'text-ink-2'}`}>
          {source.who && <span className="font-medium text-ink">@{source.who} </span>}
          {source.title}
        </span>
        <span className="shrink-0 font-mono text-[10.5px] text-faint">{ageLabel(source.at, now)}</span>
        {source.url && (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            title="Open on GitHub"
            className="ml-auto shrink-0 text-faint hover:text-accent"
          >
            <ExternalIcon />
          </a>
        )}
      </span>
      {source.excerpt && <p className="col-start-2 line-clamp-3 text-[11.5px] leading-normal text-muted select-text">“{source.excerpt}”</p>}
    </div>
  );
}
