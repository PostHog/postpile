import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Opens and closes its content by its height, so the space around it moves
 * smoothly instead of jumping: a one-row grid that goes from `1fr` to `0fr`
 * (and back) with the content clipped inside. Closing, it keeps showing
 * what it showed last while open, so a strip that leaves with a read still
 * says what it said. A fold that mounts closed is an empty, zero-high row,
 * ready to grow when it opens; one that mounts open just shows. Timing comes
 * from the caller as utilities in `className` (duration, delay, easing);
 * the fold moves nothing with reduced motion. Spacing belongs inside the
 * content, so a closed fold takes no room.
 *
 * Closed, the fold is `data-closed`: a child can fade with
 * `group-data-closed/fold:` (the NEW pill on the unread strip).
 */
export function Fold(props: { open: boolean; className?: string; children: ReactNode }) {
  const lastOpen = useRef<ReactNode>(null);
  useLayoutEffect(() => {
    if (props.open) {
      lastOpen.current = props.children;
    }
  });
  const size = props.open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr] opacity-0';
  return (
    <div
      data-closed={props.open ? undefined : ''}
      aria-hidden={props.open ? undefined : true}
      inert={!props.open}
      className={`group/fold grid transition-[grid-template-rows,opacity] motion-reduce:transition-none ${size} ${props.className ?? ''}`}
    >
      <div className="min-h-0 overflow-hidden">{props.open ? props.children : lastOpen.current}</div>
    </div>
  );
}
