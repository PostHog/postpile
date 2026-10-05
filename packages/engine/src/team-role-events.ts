// Stored events follow the viewer's team roles (DESIGN.md "Team roles").
// Loudness is decided when events are derived, and the "routing team
// mention" row reads the roles, so a role change re-derives what is stored
// instead of waiting for each PR's next fetch.
import { deriveEvents, teamRolesDiffer, type IsoTime, type Viewer } from '@postpile/core';
import type { Store } from '@postpile/store';
import { loadViewer, saveViewer } from './viewer-meta.ts';

/** Snapshots parsed at a time while deriving events again. */
const REDERIVE_CHUNK = 200;

/**
 * Derives every stored PR's events again from its stored snapshot, for
 * `viewer`. No GitHub read. `upsertDerived` keeps seen_at and every
 * override (the user's and the agent's) and only replaces the rule's
 * loudness and reason. Roles change loudness, not which events exist; an
 * id that is new anyway goes to the event log like a fetch's.
 */
export function rederiveStoredEvents(store: Store, viewer: Viewer, at: IsoTime): void {
  const keys = store.prs.keys();
  store.transaction(() => {
    // A chunk of snapshots at a time: all of them at once is gigabytes on a heavy install.
    for (let start = 0; start < keys.length; start += REDERIVE_CHUNK) {
      for (const pr of store.prs.getMany(keys.slice(start, start + REDERIVE_CHUNK)).values()) {
        const events = deriveEvents(pr, viewer, store.userPrStates.get(pr.key));
        const created = store.events.upsertDerived(pr.key, events);
        store.eventLog.append(
          created.map((id) => ({ id, prKey: pr.key })),
          at,
        );
      }
    }
  });
}

/**
 * Saves the viewer. When it splits its teams into home and routing teams
 * differently from the stored one (the first classification that changed a
 * role, a flip, a sweep, a team joined), stored events are derived again so
 * a team mention's loudness follows at once, both ways.
 */
export function saveViewerFollowingRoles(store: Store, viewer: Viewer, at: IsoTime): void {
  const before = loadViewer(store);
  saveViewer(store, viewer);
  if (before !== null && teamRolesDiffer(before, viewer)) {
    rederiveStoredEvents(store, viewer, at);
  }
}
