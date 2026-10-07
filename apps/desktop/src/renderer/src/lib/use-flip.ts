import { useLayoutEffect, useRef, type RefObject } from 'react';
import { flipMoves, type FlipPlace } from './flip.ts';
import { reducedMotion } from './motion.ts';

/** The slide: about as long as the mockup the owner approved, easing out. */
const SLIDE_MS = 420;
const SLIDE_EASING = 'cubic-bezier(.2,.7,.2,1)';
/** The "landed" tint fades out over this long, holding full for the first third. */
const LANDED_MS = 1100;

/** How far a running slide has the element shifted right now, so a measure mid-slide reads its real place. */
function currentShift(element: HTMLElement): number {
  const transform = getComputedStyle(element).transform;
  return transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m42;
}

/** Every `[data-flip-key]` element of the container, in document order, with its place. Scrolling the container does not change a place. */
function measure(container: HTMLElement, sliding: Map<HTMLElement, Animation>): { places: Map<string, FlipPlace>; elements: Map<string, HTMLElement> } {
  const origin = container.getBoundingClientRect().top - container.scrollTop;
  const places = new Map<string, FlipPlace>();
  const elements = new Map<string, HTMLElement>();
  for (const element of container.querySelectorAll<HTMLElement>('[data-flip-key]')) {
    const key = element.dataset.flipKey ?? '';
    const shift = sliding.has(element) ? currentShift(element) : 0;
    places.set(key, { top: element.getBoundingClientRect().top - origin - shift, group: element.dataset.flipGroup ?? null });
    elements.set(key, element);
  }
  return { places, elements };
}

/**
 * Slides the keyed elements of a list to their new places when it re-sorts
 * (FLIP with the Web Animations API). Mark the elements with
 * `data-flip-key` (unique, never one inside another) and, for items that sit
 * in a section, `data-flip-group`. After each render the hook measures them;
 * when the keys changed order or group since the last render, each element
 * that moved slides from its old place to the new one, and with `landed` an
 * item that changed group gets a soft selection tint that fades out. A
 * re-render that only changed sizes (new text, a resize) slides nothing.
 * With reduced motion the layout just changes.
 */
export function useFlip(containerRef: RefObject<HTMLElement | null>, options: { landed: boolean }): void {
  const last = useRef<Map<string, FlipPlace> | null>(null);
  // The slides running now, by element: a measure mid-slide takes them out, a new slide replaces the old one.
  const sliding = useRef(new Map<HTMLElement, Animation>());

  // No deps: the order can change on any render of the list.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      last.current = null;
      return;
    }
    const { places, elements } = measure(container, sliding.current);
    const before = last.current;
    last.current = places;
    if (before === null || reducedMotion()) {
      return;
    }
    const tint = getComputedStyle(document.documentElement).getPropertyValue('--accent-soft').trim();
    for (const move of flipMoves(before, places)) {
      const element = elements.get(move.key);
      if (element === undefined || typeof element.animate !== 'function') {
        continue;
      }
      if (move.dy !== 0) {
        sliding.current.get(element)?.cancel();
        const slide = element.animate([{ transform: `translateY(${move.dy}px)` }, { transform: 'translateY(0)' }], { duration: SLIDE_MS, easing: SLIDE_EASING });
        sliding.current.set(element, slide);
        const done = () => {
          if (sliding.current.get(element) === slide) {
            sliding.current.delete(element);
          }
        };
        slide.onfinish = done;
        slide.oncancel = done;
      }
      if (options.landed && move.landed && tint !== '') {
        // No end keyframe: it fades back to the element's own background.
        element.animate([{ backgroundColor: tint }, { backgroundColor: tint, offset: 0.35 }], { duration: LANDED_MS, easing: 'ease' });
      }
    }
  });
}
