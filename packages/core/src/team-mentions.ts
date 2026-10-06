// Every team a text mentions, the way `mentionsTeam` matches one: stored on
// the PR header (`pr.mentioned_teams`, DESIGN.md "PR storage") so a reader
// that does not load comment bodies can still tell which team a PR names.

/**
 * "@org/slug" where the slug does not run on (`mentionsTeam`'s terminator:
 * anything but a word character, a slash or a dash, or the end). No left
 * boundary, like `mentionsTeam`. Matches never overlap an "@": the slug
 * stops before one, so every "@" is tried.
 */
const TEAM_MENTION = /@([A-Za-z0-9-]+\/[\w-]+)(?=[^\w/-]|$)/g;

/**
 * Every "org/slug" mentioned in the texts, lowercased, unique and sorted.
 * For a team "org/slug" (an org login of letters, digits and dashes, a
 * slug of word characters and dashes), `mentionsTeam(text, team)` holds
 * exactly when this lists `team.toLowerCase()` for that text.
 */
export function teamMentions(texts: Iterable<string>): string[] {
  const found = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(TEAM_MENTION)) {
      found.add(match[1]!.toLowerCase());
    }
  }
  return [...found].sort();
}

/** The teams a PR names in its body or any comment of `Pr.comments`, for `pr.mentioned_teams`: what `for-whom.ts` scans. */
export function prTeamMentions(pr: { body: string; comments: Array<{ body: string }> }): string[] {
  return teamMentions([pr.body, ...pr.comments.map((comment) => comment.body)]);
}
