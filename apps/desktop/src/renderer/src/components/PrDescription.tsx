import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cleanPrBody, safeLinkUrl } from '../lib/markdown.ts';

/**
 * How each markdown element looks. Links open in the browser (the main
 * process sends every navigation there); remote images never load, to keep
 * tracking pixels and noise out, and show as a link with their alt text.
 */
const MARKDOWN: Components = {
  h1: (props) => <h3 className="mt-3 mb-1 text-[13.5px] font-semibold text-ink first:mt-0">{props.children}</h3>,
  h2: (props) => <h3 className="mt-3 mb-1 text-[13px] font-semibold text-ink first:mt-0">{props.children}</h3>,
  h3: (props) => <h4 className="mt-2.5 mb-1 text-[12.5px] font-semibold text-ink first:mt-0">{props.children}</h4>,
  h4: (props) => <h4 className="mt-2 mb-1 text-[12.5px] font-semibold text-ink-2 first:mt-0">{props.children}</h4>,
  h5: (props) => <h4 className="mt-2 mb-1 text-[12px] font-semibold text-ink-2 first:mt-0">{props.children}</h4>,
  h6: (props) => <h4 className="mt-2 mb-1 text-[12px] font-semibold text-muted first:mt-0">{props.children}</h4>,
  p: (props) => <p className="my-1.5 first:mt-0 last:mb-0">{props.children}</p>,
  ul: (props) => <ul className="my-1.5 list-disc pl-5">{props.children}</ul>,
  ol: (props) => <ol className="my-1.5 list-decimal pl-5">{props.children}</ol>,
  // remark-gfm marks task list items; they show their checkbox instead of a bullet.
  li: (props) => <li className={props.className?.includes('task-list-item') ? 'my-0.5 -ml-5 list-none' : 'my-0.5'}>{props.children}</li>,
  input: (props) => <input type="checkbox" checked={props.checked ?? false} disabled className="mr-1.5 align-[-1px]" readOnly />,
  blockquote: (props) => <blockquote className="my-1.5 border-l-2 border-frame pl-2.5 text-muted">{props.children}</blockquote>,
  hr: () => <hr className="my-2 border-hairline" />,
  pre: (props) => <pre className="my-1.5 overflow-x-auto rounded-md bg-subtle p-2 font-mono text-[11px] leading-[1.5]">{props.children}</pre>,
  code: (props) => <code className="rounded-[3px] bg-segment px-1 font-mono text-[11px] [pre_&]:bg-transparent [pre_&]:p-0">{props.children}</code>,
  table: (props) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="border-collapse text-[11.5px]">{props.children}</table>
    </div>
  ),
  th: (props) => <th className="border border-hairline bg-subtle px-2 py-0.5 text-left font-semibold">{props.children}</th>,
  td: (props) => <td className="border border-hairline px-2 py-0.5">{props.children}</td>,
  a: (props) => {
    const href = props.href ? safeLinkUrl(props.href) : null;
    if (!href) {
      return <span className="text-ink-2">{props.children}</span>;
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" title={href} className="text-accent underline decoration-accent-line underline-offset-2 hover:decoration-accent">
        {props.children}
      </a>
    );
  },
  img: (props) => {
    const label = props.alt ? `image: ${props.alt}` : 'image';
    const href = typeof props.src === 'string' ? safeLinkUrl(props.src) : null;
    if (!href) {
      return <span className="text-muted">[{label}]</span>;
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" title={`Not loaded here: ${href}`} className="text-muted underline decoration-frame underline-offset-2 hover:text-ink-2">
        [{label}]
      </a>
    );
  },
};

/** The fold height; taller descriptions scroll inside it until expanded. */
const FOLDED_HEIGHT = 'max-h-[160px]';

function DescriptionBox(props: { expanded: boolean; onOverflow: (overflows: boolean) => void; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const { onOverflow, expanded } = props;

  // Measured after layout: whether the text is taller than the fold decides the fade and the toggle.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || expanded) {
      return;
    }
    const measure = () => {
      const next = element.scrollHeight > element.clientHeight + 1;
      setOverflows(next);
      onOverflow(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, onOverflow]);

  function onScroll() {
    const element = box.current;
    if (element) {
      setAtBottom(element.scrollTop + element.clientHeight >= element.scrollHeight - 2);
    }
  }

  const fade = overflows && !expanded && !atBottom;
  return (
    <div className="relative">
      <div
        ref={box}
        onScroll={onScroll}
        className={`overflow-y-auto rounded-[10px] border border-hairline bg-surface px-3 py-2.5 text-[12.5px] leading-[1.5] break-words text-ink-2 select-text ${expanded ? '' : FOLDED_HEIGHT}`}
      >
        {props.children}
      </div>
      {fade && (
        // Hints that there is more below; it lets clicks through to the text.
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-px bottom-px h-10 rounded-b-[10px] bg-linear-to-b from-transparent to-surface" />
      )}
    </div>
  );
}

/**
 * The PR's own description, quiet by default: a fixed-height scroll box
 * with a fade when there is more, and Expand to show it all. Rendered as
 * GitHub markdown without raw HTML; template comments are dropped. An
 * empty body leaves the section out.
 */
export function PrDescription(props: { body: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const text = cleanPrBody(props.body);
  if (!text) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center">
        <span className="text-[11px] font-semibold tracking-[0.04em] text-muted">Description</span>
        {(overflows || expanded) && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="ml-auto text-[11.5px] text-muted hover:text-ink">
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
      <DescriptionBox expanded={expanded} onOverflow={setOverflows}>
        <Markdown remarkPlugins={[remarkGfm]} skipHtml components={MARKDOWN}>
          {text}
        </Markdown>
      </DescriptionBox>
    </div>
  );
}
