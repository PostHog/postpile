// Which pending review requests CODEOWNERS made (2026-10-29, DESIGN.md
// "Picked, pulled in or routed"): JSON text of the logins and "org/team"
// names GitHub marks `asCodeOwner`, a subset of reviewer_users and
// reviewer_teams. A header column next to them, written on every upsert.
//
// DDL only: a nullable `ADD COLUMN` is instant at any size. PRs stored
// before stay NULL, read back as not known (`Pr.codeOwnerReviewers`
// missing), which counts as routed until the next fetch of the PR writes it.

export const version = 42;

export const sql = `
ALTER TABLE pr ADD COLUMN code_owner_reviewers TEXT;
`;
