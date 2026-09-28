// Board.load reads every event of every stored PR, ordered per PR. With the
// old (pr_key, at) index SQLite sorted all rows in a temp B-tree on each
// read (~6 ms of ~12 ms for ~7k events). (pr_key, at, id) matches the ORDER
// BY pr_key, at, id of EventRepo.listForPrs, so the rows come out of the
// index already in order. It also covers every query the old index served.

export const version = 12;

export const sql = `
CREATE INDEX pr_event_pr_key_at_id ON pr_event (pr_key, at, id);
DROP INDEX pr_event_pr_key;
`;
