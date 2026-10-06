// A review's permalink (2026-10-06, DESIGN.md "The PR pane" › Activity):
// every activity row's age links to the event on github.com, and a review
// without text has no body comment whose link it could borrow.
//
// DDL only: a nullable `ADD COLUMN` is instant at any size. Rows stored
// before stay NULL until their PR is fetched again; until then the review's
// event falls back to its body comment's link, else to no link.

export const version = 36;

export const sql = `
ALTER TABLE pr_review ADD COLUMN url TEXT;
`;
