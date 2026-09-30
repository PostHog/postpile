/** At most this many assignees get a face and a name; the rest are "+N". */
export const SHOWN_ASSIGNEES = 2;

/** One assignee as the line shows it: the face's login and the word ("you" for the viewer). */
export interface ShownAssignee {
  login: string;
  name: string;
}

/** The "assigned to" part of a PR row or the detail pane. */
export interface AssigneeLine {
  /** The first assignees other than the author, at most `SHOWN_ASSIGNEES`. */
  shown: ShownAssignee[];
  /** How many more are assigned: "+N". */
  more: number;
  /** Every name, for the tooltip: "Opened by acme-agent[bot], assigned to you and bob". */
  title: string;
}

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** "alice", "alice and bob", "alice, bob and carol". */
function namesText(names: string[]): string {
  if (names.length <= 1) {
    return names.join('');
  }
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Who the PR is assigned to, when that is not just its author. An agent PR
 * a bot opened for someone names that person here, so the row says whose it
 * is; a person's PR assigned to the viewer says "assigned to you". Null when
 * nobody else is assigned: the author's avatar says it all.
 */
export function assigneeLine(author: string, assignees: string[], viewerLogin: string | null): AssigneeLine | null {
  const others = assignees.filter((login) => !sameLogin(login, author));
  if (others.length === 0) {
    return null;
  }
  const named = others.map((login) => ({ login, name: viewerLogin !== null && sameLogin(login, viewerLogin) ? 'you' : login }));
  const shown = named.slice(0, SHOWN_ASSIGNEES);
  return {
    shown,
    more: others.length - shown.length,
    title: `Opened by ${author}, assigned to ${namesText(named.map((assignee) => assignee.name))}`,
  };
}
