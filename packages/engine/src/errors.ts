/** The message of anything thrown, for sync reports and action results. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
