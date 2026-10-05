import type { DatabaseSync } from 'node:sqlite';

// Thin typed wrappers over node:sqlite. Rows come back as plain records; the
// repositories map them to domain types by hand.

export type SqlValue = null | number | bigint | string;

export function all<T>(db: DatabaseSync, sql: string, ...params: SqlValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[];
}

/** Rows one at a time, for big reads: the rows never sit in memory as one array next to what they are mapped to. */
export function each<T>(db: DatabaseSync, sql: string, ...params: SqlValue[]): Iterable<T> {
  return db.prepare(sql).iterate(...params) as unknown as Iterable<T>;
}

export function one<T>(db: DatabaseSync, sql: string, ...params: SqlValue[]): T | null {
  const row = db.prepare(sql).get(...params) as unknown as T | undefined;
  return row ?? null;
}

/** Returns the number of changed rows. */
export function run(db: DatabaseSync, sql: string, ...params: SqlValue[]): number {
  return Number(db.prepare(sql).run(...params).changes);
}

export function insertReturningId(db: DatabaseSync, sql: string, ...params: SqlValue[]): number {
  return Number(db.prepare(sql).run(...params).lastInsertRowid);
}

/** "?, ?, ?" for an IN (...) list. */
export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

export function toBool(value: number): boolean {
  return value !== 0;
}

export function fromBool(value: boolean): number {
  return value ? 1 : 0;
}
