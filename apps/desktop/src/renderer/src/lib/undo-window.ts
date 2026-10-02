/**
 * How long a mark-read waits in the engine's queue before it goes to GitHub,
 * and so how long Undo is offered. Matches UNDO_WINDOW_MS in core; the
 * renderer imports types only.
 */
export const UNDO_WINDOW_MS = 6000;
