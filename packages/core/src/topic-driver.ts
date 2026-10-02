// Who drives a topic (DESIGN.md "Driver picker", "Team as driver",
// 2026-10-02). The automatic driver is stored on the topic and refreshed
// each sync from the dossier or the PR authors; the user's pick from the
// header menu is stored apart and always wins until they reset it. New
// events never lift it, unlike the relation "Wrong".
import { personRelation, type PersonRelation } from './topic-queues.ts';
import type { Viewer } from './types.ts';
import type { TopicDriverView } from './views.ts';

/**
 * Stored driver values that name no single person. GitHub logins hold
 * letters, digits and hyphens only, so the colon never clashes with one.
 * TEAM_DRIVER: the viewer's home team keeps the topic up, nobody leads
 * the current wave (the picker's "Your team", the dossier's driverTeam).
 * OUTSIDE_DRIVER: someone outside the viewer's teams, no name needed
 * (the picker's "Someone outside your team").
 */
export const TEAM_DRIVER = ':team';
export const OUTSIDE_DRIVER = ':outside';

/** A driver as the header and its menu name it: the viewer, a person by login, the home team, someone outside it. */
export type DriverKind = 'you' | 'person' | 'team' | 'outside';

/** How a stored driver value relates to the viewer: teammates are members of any home team (`Viewer.teamMembers`). */
export function driverRelation(driver: string | null, viewer: Viewer | null): PersonRelation | null {
  if (driver === null) {
    return null;
  }
  if (driver === TEAM_DRIVER) {
    return 'team';
  }
  if (driver === OUTSIDE_DRIVER) {
    return 'other';
  }
  return personRelation(driver, viewer);
}

/** The login a stored driver value names; null for the team, someone outside, or nobody. */
export function driverLogin(driver: string | null): string | null {
  return driver === null || driver === TEAM_DRIVER || driver === OUTSIDE_DRIVER ? null : driver;
}

/** How the header names a stored driver value. */
export function driverKind(driver: string, viewer: Viewer | null): DriverKind {
  if (driver === TEAM_DRIVER) {
    return 'team';
  }
  if (driver === OUTSIDE_DRIVER) {
    return 'outside';
  }
  return driverRelation(driver, viewer) === 'you' ? 'you' : 'person';
}

/** The driver in effect: the user's pick when there is one, else the automatic driver. */
export interface EffectiveDriver {
  /** A login, TEAM_DRIVER or OUTSIDE_DRIVER; null when nobody is known. */
  value: string | null;
  /** `topicSection`'s driver input. */
  relation: PersonRelation | null;
  /** The user picked it in the header menu ("set by you"). */
  picked: boolean;
}

export function effectiveDriver(pick: string | null, automatic: string | null, viewer: Viewer | null): EffectiveDriver {
  const value = pick ?? automatic;
  return { value, relation: driverRelation(value, viewer), picked: pick !== null };
}

/** The values the header menu offers: the viewer, each teammate, the team, someone outside. */
export function driverPickValues(viewer: Viewer | null): string[] {
  const people = viewer ? [viewer.login, ...(viewer.teamMembers ?? [])] : [];
  return [...people, TEAM_DRIVER, OUTSIDE_DRIVER];
}

/** The driver in words for the CLI and MCP reads: a login, "the user's team", "someone outside the user's team", "unknown". */
export function driverText(view: Pick<TopicDriverView, 'kind' | 'login' | 'picked'> | null): string {
  if (view === null || view.kind === null) {
    return 'unknown';
  }
  const who: Record<DriverKind, string> = {
    you: view.login ?? 'the user',
    person: view.login ?? 'unknown',
    team: "the user's team",
    outside: "someone outside the user's team",
  };
  return view.picked ? `${who[view.kind]} (set by the user)` : who[view.kind];
}
