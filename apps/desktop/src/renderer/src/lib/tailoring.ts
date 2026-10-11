/**
 * The header over a topic's tailoring lines. Was "You told the agent:", which
 * claimed words the user never typed for kept lessons, accepted rules and
 * merged lines (2026-10-11, owner).
 */
export const TAILORING_HEADER = 'Kept for this topic';

/**
 * A topic's tailoring, one entry per line, blank lines left out. The same
 * split as core's `tailoringLines`, which the engine uses to remove a line:
 * keep them in step.
 */
export function tailoringLines(tailoring: string): string[] {
  return tailoring
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}
