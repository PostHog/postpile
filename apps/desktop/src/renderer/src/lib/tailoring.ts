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
