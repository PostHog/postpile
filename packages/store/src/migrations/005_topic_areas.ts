// Topics get a broad area ("CI", "Dev env") for grouping in the sidebar, and
// consolidation can propose folding one area into another (area_merge
// proposals name the area folded away in from_area).

export const version = 5;

export const sql = `
ALTER TABLE topic ADD COLUMN area TEXT;
ALTER TABLE topic_proposal ADD COLUMN from_area TEXT;
`;
