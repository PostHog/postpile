import { useRef, type PointerEvent } from 'react';

interface PaneDividerProps {
  /** Label for screen readers and the hover title. */
  label: string;
  /** CSS left offset of the column edge inside the grid (a calc of the columns before it). */
  left: string;
  /** The pane's current width in px, read when a drag starts. */
  startWidth: () => number;
  /** A clamped width for a raw one, called on every move. */
  clamp: (width: number) => number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
  onReset: () => void;
}

/**
 * A draggable column edge: a 1px line is already drawn by the pane borders,
 * this adds a wide invisible hit area on top of it. Pointer capture keeps the
 * drag going when the pointer leaves the strip; double-click resets.
 */
export function PaneDivider(props: PaneDividerProps) {
  const drag = useRef<{ x: number; width: number; last: number } | null>(null);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const width = props.startWidth();
    drag.current = { x: event.clientX, width, last: width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) {
      return;
    }
    const width = props.clamp(current.width + event.clientX - current.x);
    if (width !== current.last) {
      current.last = width;
      props.onResize(width);
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    // A plain click (no movement) stores nothing, so a double-click reset is not undone.
    if (current && current.last !== current.width) {
      props.onCommit(current.last);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label}
      title={`${props.label}. Drag to resize, double-click to reset.`}
      // The offset follows the column sizes, which are render-time values.
      style={{ left: props.left }}
      className="group absolute inset-y-0 z-20 -ml-1.5 w-3 cursor-col-resize touch-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={props.onReset}
    >
      <div className="mx-auto h-full w-px bg-transparent group-hover:bg-accent-line group-active:bg-accent" />
    </div>
  );
}
