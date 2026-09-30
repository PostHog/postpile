import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cleanPrBody } from '../lib/markdown.ts';
import { MarkdownText } from './MarkdownText.tsx';
import { SectionLabel } from './SectionLabel.tsx';

/** The fold height; taller descriptions scroll inside it until expanded. */
const FOLDED_HEIGHT = 'max-h-[150px]';

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

  // The text fades out with a mask while there is more below, instead of a hard cut mid-line.
  const fade = overflows && !expanded && !atBottom;
  return (
    <div
      ref={box}
      onScroll={onScroll}
      className={`overflow-y-auto rounded-group bg-surface p-3 text-[12.5px] leading-[1.55] break-words text-ink-2 select-text inset-ring inset-ring-edge-hairline ${expanded ? '' : FOLDED_HEIGHT} ${fade ? 'mask-b-from-70%' : ''}`}
    >
      {props.children}
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
    <div className="flex flex-col gap-[7px]">
      <div className="flex items-baseline px-3">
        <SectionLabel>Description</SectionLabel>
        {(overflows || expanded) && (
          <button type="button" onClick={() => setExpanded(!expanded)} className="ml-auto text-[11.5px] font-medium text-accent hover:underline">
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        )}
      </div>
      <DescriptionBox expanded={expanded} onOverflow={setOverflows}>
        <MarkdownText text={text} />
      </DescriptionBox>
    </div>
  );
}
