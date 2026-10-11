// The owner part of the topic header's relation line. The owner team is a
// weak signal (DESIGN.md "Ownership sections": it only places a topic
// nobody is known to drive), so when the driver placed the topic somewhere
// else (`TopicDriverView.driverDecides`) the line leads with the driver and
// keeps the team as "usually" (BOARD-A-13, owner 2026-10-11).
import type { TopicDriverView } from '@postpile/core';
import { driverLabel } from './driver.ts';

/** The line's words around the team name, which the header shows a shade darker. */
export interface OwnerLine {
  before: string;
  team: string | null;
}

/** "team-platform" from "acme/team-platform". */
function teamSlug(team: string): string {
  return team.slice(team.lastIndexOf('/') + 1);
}

/**
 * "Owned by acme/team-platform"; "omar drives · usually team-platform" when
 * the driver, not the owner team, placed the topic; "Owner not known"
 * without an owner team.
 */
export function ownerLine(ownerTeam: string | null, driver: Pick<TopicDriverView, 'kind' | 'login' | 'driverDecides'> | null): OwnerLine {
  if (ownerTeam === null) {
    return { before: 'Owner not known', team: null };
  }
  if (driver === null || driver.kind === null || !driver.driverDecides) {
    return { before: 'Owned by ', team: ownerTeam };
  }
  return { before: `${driverLabel(driver)} · usually `, team: teamSlug(ownerTeam) };
}

/** The whole line as text, for the correction's record. */
export function ownerLineText(line: OwnerLine): string {
  return `${line.before}${line.team ?? ''}`;
}
