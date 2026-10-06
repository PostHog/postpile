// Bot talk leaves agent work (2026-10-06, DESIGN.md of the same name): an
// event says whether it is chatter, a person's bot talk that asks the viewer
// nothing (a "fixed" in a bot-only thread, "@codex review"), an edit of
// it, or the empty review GitHub made to carry thread replies. Chatter
// never starts a dossier update and never goes to the events agent.
//
// Every sync derives the flag again for the PRs it fetches. Rows stored
// before are filled from their rule reason where it already says so (a
// reply to a bot, a carrier review), so their PRs need no fetch first; the
// viewer's own replies and bot commands get it on their PR's next fetch.

export const version = 32;

export const sql = `
ALTER TABLE pr_event ADD COLUMN chatter INTEGER NOT NULL DEFAULT 0;
UPDATE pr_event SET chatter = 1
  WHERE kind IN ('comment', 'review_commented')
    AND rule_reason IN ('replied to a bot in a review thread', 'only carries replies in review threads');
`;
