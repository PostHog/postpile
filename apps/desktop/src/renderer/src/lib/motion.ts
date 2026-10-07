// Shared by the motion hooks: every slide, fold and flight checks it, so with
// reduced motion everything lands at once.

export function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
