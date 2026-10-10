/** "1 tile", "2 tiles"; pass `many` for words that do not just add an s ("1 PR", "2 PRs" works, "1 reply", "2 replies" does not). */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
