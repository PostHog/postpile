// The last line of defence against a title, repo name or path leaking into
// telemetry by accident: every string property is checked before it leaves
// the process, whatever produced it. Short enums and counts always pass;
// anything that looks like a title or a path never does.

/** Longer than any of the catalogue's real enum values; long enough to catch a leaked title or sentence. */
export const MAX_TELEMETRY_STRING_LENGTH = 40;

function looksSafe(value: string): boolean {
  return value.length <= MAX_TELEMETRY_STRING_LENGTH && !value.includes('/') && !value.includes('#');
}

/**
 * Drops any string property that is too long or contains '/' or '#' (a repo
 * name, a branch, a PR reference, a path). `onDropped` is called once per
 * dropped key, for a one-line log; everything else passes through unchanged.
 */
export function sanitizeTelemetryProps<T extends Record<string, unknown>>(props: T, onDropped: (key: string) => void = () => {}): Partial<T> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'string' && !looksSafe(value)) {
      onDropped(key);
      continue;
    }
    clean[key] = value;
  }
  return clean as Partial<T>;
}
