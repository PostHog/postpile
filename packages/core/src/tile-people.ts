// The people a tile is about, for the small avatar stack in its header.
import { isBot } from './bots.ts';
import { sameLogin } from './mentions.ts';
import { prOwners } from './pr-owners.ts';
import type { Pr } from './types.ts';

/** assignee: owns a bot's PR through its assignment (`prOwners`). */
export type TilePersonRole = 'author' | 'assignee' | 'you' | 'reviewer';

export interface TilePerson {
  login: string;
  role: TilePersonRole;
}

/** How many faces the header has room for. */
export const TILE_PEOPLE_MAX = 4;

/**
 * Owners first (in member order: the author, or the assignees of a bot's
 * PR, `prOwners`), then the viewer when they reviewed any of the PRs, then
 * other people who reviewed or are asked to. Each login once; bots only
 * count as authors, the viewer only as owner or reviewer.
 */
export function tilePeople(prs: Pr[], viewerLogin: string | null, max = TILE_PEOPLE_MAX): TilePerson[] {
  const people: TilePerson[] = [];
  const add = (login: string, role: TilePersonRole) => {
    if (!people.some((person) => sameLogin(person.login, login))) {
      people.push({ login, role });
    }
  };
  const isViewer = (login: string) => viewerLogin !== null && sameLogin(login, viewerLogin);
  for (const pr of prs) {
    for (const owner of prOwners(pr)) {
      if (isViewer(owner)) {
        add(owner, 'you');
      } else {
        add(owner, sameLogin(owner, pr.author) ? 'author' : 'assignee');
      }
    }
  }
  const reviewed = prs.flatMap((pr) => pr.reviews.filter((review) => review.state !== 'PENDING').map((review) => review.author));
  if (viewerLogin !== null && reviewed.some(isViewer)) {
    add(viewerLogin, 'you');
  }
  // A pending request for the viewer is not a face: it is their own move, the footer says so.
  const asked = prs.flatMap((pr) => pr.reviewerUsers);
  for (const login of [...reviewed, ...asked]) {
    if (!isBot(login) && !isViewer(login)) {
      add(login, 'reviewer');
    }
  }
  return people.slice(0, max);
}
