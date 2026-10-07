import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { reducedMotion } from '../lib/motion.ts';

/**
 * Swaps its content in place. When `swapKey` changes while `animate` is on,
 * what it showed before stays on top for a moment and leaves with
 * `leaveClass` while the new content arrives with `enterClass` (CSS
 * animations from app.css, with their delay). Both sit in one grid cell,
 * so the swap moves nothing; the old copy is inert. Without `animate`, or
 * with reduced motion, it just swaps. The first render never animates.
 */
export function Crossfade(props: { swapKey: string; animate: boolean; enterClass: string; leaveClass: string; className?: string; children: ReactNode }) {
  // What is on screen now, so the next swap can keep it for the way out.
  const committed = useRef<ReactNode>(props.children);
  useLayoutEffect(() => {
    committed.current = props.children;
  });
  const [key, setKey] = useState(props.swapKey);
  const [leaving, setLeaving] = useState<ReactNode>(null);
  const [entering, setEntering] = useState(false);
  if (key !== props.swapKey) {
    // The documented "adjust state while rendering" pattern: React re-renders right away with it.
    const animate = props.animate && !reducedMotion();
    setKey(props.swapKey);
    setLeaving(animate ? committed.current : null);
    setEntering(animate);
  }
  return (
    <span className={`inline-grid ${props.className ?? ''}`}>
      {leaving !== null && (
        <span
          aria-hidden="true"
          inert
          className={`pointer-events-none col-start-1 row-start-1 ${props.leaveClass}`}
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) {
              setLeaving(null);
            }
          }}
        >
          {leaving}
        </span>
      )}
      <span key={key} className={`col-start-1 row-start-1 ${entering ? props.enterClass : ''}`}>
        {props.children}
      </span>
    </span>
  );
}
