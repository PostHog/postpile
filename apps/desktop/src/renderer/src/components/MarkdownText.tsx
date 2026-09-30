import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeLinkUrl } from '../lib/markdown.ts';

/**
 * How each markdown element looks. Links open in the browser (the main
 * process sends every navigation there); remote images never load, to keep
 * tracking pixels and noise out, and show as a link with their alt text.
 */
const MARKDOWN: Components = {
  h1: (props) => <h3 className="mt-3 mb-1 text-[13.5px] font-[650] text-ink first:mt-0">{props.children}</h3>,
  h2: (props) => <h3 className="mt-3 mb-1 text-[13px] font-[650] text-ink first:mt-0">{props.children}</h3>,
  h3: (props) => <h4 className="mt-2.5 mb-1 text-[12.5px] font-semibold text-ink first:mt-0">{props.children}</h4>,
  h4: (props) => <h4 className="mt-2 mb-1 text-[12.5px] font-semibold text-ink-2 first:mt-0">{props.children}</h4>,
  h5: (props) => <h4 className="mt-2 mb-1 text-[12px] font-semibold text-ink-2 first:mt-0">{props.children}</h4>,
  h6: (props) => <h4 className="mt-2 mb-1 text-[12px] font-semibold text-muted first:mt-0">{props.children}</h4>,
  p: (props) => <p className="mt-0 mb-2.5 text-pretty last:mb-0">{props.children}</p>,
  ul: (props) => <ul className="my-1.5 list-disc pl-5">{props.children}</ul>,
  ol: (props) => <ol className="my-1.5 list-decimal pl-5">{props.children}</ol>,
  // remark-gfm marks task list items; they show their checkbox instead of a bullet.
  li: (props) => <li className={props.className?.includes('task-list-item') ? 'my-0.5 -ml-5 list-none' : 'my-0.5'}>{props.children}</li>,
  input: (props) => <input type="checkbox" checked={props.checked ?? false} disabled className="mr-1.5 align-[-1px]" readOnly />,
  blockquote: (props) => <blockquote className="my-1.5 border-l-2 border-frame pl-2.5 text-muted">{props.children}</blockquote>,
  hr: () => <hr className="my-2 border-hairline" />,
  pre: (props) => <pre className="my-1.5 overflow-x-auto rounded-md bg-subtle p-2 font-mono text-[11px] leading-[1.5]">{props.children}</pre>,
  code: (props) => <code className="rounded-[3px] bg-ref px-[3px] font-mono text-[11px] [pre_&]:bg-transparent [pre_&]:p-0">{props.children}</code>,
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


/** Comments are quieter than a description: one size for every heading, tighter gaps. */
const COMPACT_HEADING = (props: { children?: ReactNode }) => <p className="mt-2 mb-1 text-[12px] font-semibold text-ink first:mt-0">{props.children}</p>;

const COMPACT: Components = {
  ...MARKDOWN,
  h1: COMPACT_HEADING,
  h2: COMPACT_HEADING,
  h3: COMPACT_HEADING,
  h4: COMPACT_HEADING,
  h5: COMPACT_HEADING,
  h6: COMPACT_HEADING,
  p: (props) => <p className="mt-0 mb-1.5 text-pretty last:mb-0">{props.children}</p>,
  ul: (props) => <ul className="my-1 list-disc pl-4">{props.children}</ul>,
  ol: (props) => <ol className="my-1 list-decimal pl-4">{props.children}</ol>,
  li: (props) => <li className={props.className?.includes('task-list-item') ? '-ml-4 list-none' : ''}>{props.children}</li>,
  pre: (props) => <pre className="my-1 overflow-x-auto rounded-md bg-subtle p-1.5 font-mono text-[10.5px] leading-[1.45]">{props.children}</pre>,
};

/**
 * GitHub markdown without raw HTML (the text is untrusted). `compact` is the
 * comment look: smaller, tighter. The parent sets the base text size and color.
 */
export function MarkdownText(props: { text: string; compact?: boolean }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={props.compact ? COMPACT : MARKDOWN}>
      {props.text}
    </Markdown>
  );
}
