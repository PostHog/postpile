// Pure rules of the setup flow: summarising the sweep's GitHub material,
// handing out source ids, and mapping the agent's draft back onto known
// sources and repos. DESIGN.md "Setup flow".

import { clipText } from './dossier.ts';
import type {
  ActivityPr,
  ActivityRole,
  SetupClaim,
  SetupDraft,
  SetupDraftSection,
  SetupMaterial,
  SetupRepoCount,
  SetupRepoPick,
  SetupSource,
} from './setup.ts';
import type { Viewer } from './types.ts';

/** Days of GitHub activity the sweep reads. */
export const SETUP_ACTIVITY_DAYS = 30;
/** PRs the activity search returns at most, over all three searches. */
export const SETUP_PR_CAP = 100;
/** Busiest repos whose CODEOWNERS the sweep reads. */
export const SETUP_CODEOWNERS_REPOS = 5;
/** CODEOWNERS lines kept per repo. */
export const SETUP_CODEOWNERS_LINES = 20;
/** Where GitHub looks for CODEOWNERS, in its order. */
export const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
/**
 * owners.yaml files (the owners-yaml format): the repo root's, then one per
 * top-level folder the user's PRs touch most, at most this many folders.
 */
export const SETUP_OWNERS_YAML_DIRS = 6;
export const OWNERS_YAML_FILE = 'owners.yaml';

/** The sections a draft is written in, the same shape as a hand-written instructions.md. */
export const SETUP_HEADINGS = ['About me', 'What I own', 'What gets routed to me', 'What to ignore or keep quiet', 'Preferences'];

/** Bounds on the agent's answer, so a runaway draft cannot bloat every prompt later. */
export const SETUP_LIMITS = {
  sections: 8,
  claimsPerSection: 12,
  claimChars: 300,
  sourcesPerClaim: 4,
  quietRepos: 10,
  whyChars: 240,
  summaryChars: 400,
};

/**
 * Top-level folders of the changed files, most files first, at most `max`.
 * Files at the top of the repo count as "(root)".
 */
export function topLevelDirs(paths: string[], max = 4): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const slash = path.indexOf('/');
    const dir = slash === -1 ? '(root)' : `${path.slice(0, slash)}/`;
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([dir]) => dir);
}

const ROLE_FIELDS: Record<ActivityRole, 'authored' | 'reviewed' | 'requested'> = {
  authored: 'authored',
  reviewed: 'reviewed',
  review_requested: 'requested',
};

/** Repos by how many of the user's PRs touch them, then by PRs they wrote, then by name. */
export function rankActivityRepos(prs: ActivityPr[]): SetupRepoCount[] {
  const byRepo = new Map<string, SetupRepoCount>();
  for (const pr of prs) {
    const count = byRepo.get(pr.repo) ?? { repo: pr.repo, prs: 0, authored: 0, reviewed: 0, requested: 0 };
    count.prs += 1;
    count[ROLE_FIELDS[pr.role]] += 1;
    byRepo.set(pr.repo, count);
  }
  return [...byRepo.values()].sort((a, b) => b.prs - a.prs || b.authored - a.authored || a.repo.localeCompare(b.repo));
}

/** "@alice" and "@acme/devex" for each of the viewer's teams, lowercased. */
export function ownerHandles(viewer: Viewer): string[] {
  return [`@${viewer.login}`, ...viewer.teams.map((team) => `@${team}`)].map((handle) => handle.toLowerCase());
}

/**
 * The CODEOWNERS rules that name one of `handles` (case does not matter),
 * comments and blank lines dropped, at most SETUP_CODEOWNERS_LINES.
 */
export function codeownersLines(text: string, handles: string[]): string[] {
  const wanted = new Set(handles.map((handle) => handle.toLowerCase()));
  const kept: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s#.*$/, '').trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const owners = line.split(/\s+/).slice(1);
    if (owners.some((owner) => wanted.has(owner.toLowerCase()))) {
      kept.push(line);
    }
    if (kept.length >= SETUP_CODEOWNERS_LINES) {
      break;
    }
  }
  return kept;
}

/**
 * The top-level folders the user's PRs in `repo` touch, most PRs first, at
 * most SETUP_OWNERS_YAML_DIRS; "(root)" is left out. Each may hold an owners.yaml.
 */
export function busiestDirs(prs: ActivityPr[], repo: string): string[] {
  const counts = new Map<string, number>();
  for (const pr of prs) {
    if (pr.repo !== repo) {
      continue;
    }
    for (const dir of pr.dirs) {
      if (dir !== '(root)') {
        counts.set(dir, (counts.get(dir) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, SETUP_OWNERS_YAML_DIRS)
    .map(([dir]) => dir);
}

/**
 * How owners.yaml names the viewer: "@alice", a team as "@acme/devex" or,
 * inside its own org, as the bare slug "devex". Lowercased.
 */
export function ownersYamlHandles(viewer: Viewer): string[] {
  const slugs = viewer.teams.map((team) => team.slice(team.indexOf('/') + 1));
  return [...ownerHandles(viewer), ...slugs].map((handle) => handle.toLowerCase());
}

/** "[a, 'b']", "'c'" or "d" as plain values. */
function yamlValues(text: string): string[] {
  return text
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
    .filter((value) => value !== '');
}

/** The rules under "rules:" as raw line groups, one per list item, comments and blank lines dropped. */
function ownersYamlItems(text: string): string[][] {
  const lines = text.split('\n').map((line) => line.replace(/\s+#.*$/, '').trimEnd());
  const start = lines.findIndex((line) => /^\s*rules:\s*$/.test(line));
  if (start === -1) {
    return [];
  }
  const rulesIndent = lines[start]!.search(/\S/);
  const items: string[][] = [];
  let itemIndent = -1;
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const indent = line.search(/\S/);
    if (indent <= rulesIndent && !trimmed.startsWith('-')) {
      break;
    }
    if (trimmed.startsWith('- ') && (itemIndent === -1 || indent === itemIndent)) {
      itemIndent = indent;
      items.push([trimmed.slice(2).trim()]);
    } else if (items.length > 0) {
      items[items.length - 1]!.push(trimmed);
    }
  }
  return items;
}

/** One rule's fields: "match" and owner keys ("owners", "additions", ...) with their values. */
function ownersYamlFields(item: string[]): Map<string, string[]> {
  const fields = new Map<string, string[]>();
  let key = '';
  for (const line of item) {
    const field = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (field) {
      key = field[1]!;
      fields.set(key, yamlValues(field[2]!));
    } else if (line.startsWith('- ') && key !== '') {
      fields.get(key)!.push(...yamlValues(line.slice(2)));
    }
  }
  return fields;
}

/** A pattern as seen from the repo root: "/workflows/" in ".github/" is "/.github/workflows/". */
function rootPattern(folder: string, pattern: string): string {
  if (folder === '') {
    return pattern;
  }
  return pattern.startsWith('/') ? `/${folder}${pattern.slice(1)}` : `/${folder}**/${pattern}`;
}

/**
 * The owners.yaml rules (in `folder`, "" for the root, else "tools/") that
 * name one of `handles`, one line each: "/tools/hogli/, /bin/ -> owners:
 * team-devex". Patterns read from the repo root. At most SETUP_CODEOWNERS_LINES.
 */
export function ownersYamlLines(text: string, folder: string, handles: string[]): string[] {
  const wanted = new Set(handles.map((handle) => handle.toLowerCase()));
  const kept: string[] = [];
  for (const item of ownersYamlItems(text)) {
    const fields = ownersYamlFields(item);
    const patterns = fields.get('match') ?? [];
    const owners = [...fields.entries()].filter(([key]) => key !== 'match');
    const named = owners.some(([, values]) => values.some((value) => wanted.has(value.toLowerCase())));
    if (patterns.length === 0 || !named) {
      continue;
    }
    const who = owners.map(([key, values]) => `${key}: ${values.join(', ')}`).join('; ');
    kept.push(`${patterns.map((pattern) => rootPattern(folder, pattern)).join(', ')} -> ${who}`);
    if (kept.length >= SETUP_CODEOWNERS_LINES) {
      break;
    }
  }
  return kept;
}

const ROLE_WORDS: Record<ActivityRole, string> = {
  authored: 'you wrote it',
  reviewed: 'you reviewed it',
  review_requested: 'your review is requested',
};

/**
 * Short ids for everything a draft may cite: "t1".. teams, "p1".. PRs,
 * "o1".. CODEOWNERS excerpts, "d1" the digest. The prompt and the "Why?"
 * panel use the same list.
 */
export function setupSources(material: SetupMaterial): SetupSource[] {
  const teams = material.viewer.teams.map(
    (team, index): SetupSource => ({
      id: `t${index + 1}`,
      kind: 'team',
      label: `Team ${team}`,
      detail: `You are on ${team} (GitHub teams).`,
      url: null,
    }),
  );
  const prs = material.prs.map(
    (pr, index): SetupSource => ({
      id: `p${index + 1}`,
      kind: 'pr',
      label: pr.key,
      detail: `${ROLE_WORDS[pr.role]} · ${pr.state.toLowerCase()} · “${pr.title}”${pr.dirs.length > 0 ? ` · ${pr.dirs.join(', ')}` : ''}`,
      url: pr.url,
    }),
  );
  const codeowners = material.codeowners.map(
    (excerpt, index): SetupSource => ({
      id: `o${index + 1}`,
      kind: 'codeowners',
      label: `${excerpt.repo} ${excerpt.path}`,
      detail: excerpt.lines.join('\n'),
      url: `https://github.com/${excerpt.repo}/blob/HEAD/${excerpt.path}`,
    }),
  );
  const digest: SetupSource[] = material.digest
    ? [{ id: 'd1', kind: 'digest', label: `Work context v${material.digest.version}`, detail: clipText(material.digest.text, 400), url: null }]
    : [];
  return [...teams, ...prs, ...codeowners, ...digest];
}

/** A draft section's text: one "- " line per claim. */
export function claimsBody(claims: SetupClaim[]): string {
  return claims.map((claim) => `- ${claim.text}`).join('\n');
}

/** A body line without its bullet, for matching the user's own lines. */
export function claimKey(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, '')
    .trim()
    .toLowerCase();
}

/**
 * Lines of the edited sections the previous draft did not have: the user's
 * own words, in claimKey form. A refine keeps them and they need no source.
 */
export function userWrittenLines(edits: { body: string }[], previous: SetupDraft | null): string[] {
  const agentLines = new Set((previous?.sections ?? []).flatMap((section) => section.claims.map((claim) => claimKey(claim.text))));
  const lines = edits.flatMap((edit) => edit.body.split('\n')).map(claimKey);
  return [...new Set(lines)].filter((line) => line !== '' && !agentLines.has(line));
}

/** The agent's answer after zod, before any id or repo is checked. */
export interface SetupDraftAnswer {
  summary: string;
  sections: { heading: string; claims: { text: string; sources: string[] }[] }[];
  quietRepos: { repo: string; why: string; sources: string[] }[];
  mainRepo: { repo: string; why: string; sources: string[] } | null;
}

export interface MapSetupDraftInput {
  answer: SetupDraftAnswer;
  sources: SetupSource[];
  repos: SetupRepoCount[];
  model: string | null;
  /** Lines the user wrote themselves (claimKey form); a claim matching one is marked fromUser. */
  userLines?: Set<string>;
}

/**
 * The answer onto what the sweep really saw: unknown source ids are dropped
 * (each claim keeps at most SETUP_LIMITS.sourcesPerClaim), repos the sweep
 * did not see are dropped from the suggestions, texts are clipped and empty
 * sections left out. A claim that cites nothing stays: the UI says so.
 */
export function mapSetupDraft(input: MapSetupDraftInput): SetupDraft {
  const known = new Set(input.sources.map((source) => source.id));
  const repoNames = new Map(input.repos.map((repo) => [repo.repo.toLowerCase(), repo.repo]));
  const cite = (ids: string[]) => [...new Set(ids.map((id) => id.trim()))].filter((id) => known.has(id)).slice(0, SETUP_LIMITS.sourcesPerClaim);
  const pick = (raw: { repo: string; why: string; sources: string[] }): SetupRepoPick | null => {
    const repo = repoNames.get(raw.repo.trim().toLowerCase());
    return repo ? { repo, why: clipText(raw.why, SETUP_LIMITS.whyChars), sourceIds: cite(raw.sources) } : null;
  };
  const sections: SetupDraftSection[] = [];
  for (const raw of input.answer.sections) {
    const heading = clipText(raw.heading.replace(/^#+\s*/, ''), 80);
    const claims = raw.claims
      .map((claim) => ({ text: clipText(claim.text.replace(/^[-*]\s+/, ''), SETUP_LIMITS.claimChars), sources: claim.sources }))
      .filter((claim) => claim.text !== '')
      .slice(0, SETUP_LIMITS.claimsPerSection)
      .map((claim): SetupClaim => ({ text: claim.text, sourceIds: cite(claim.sources), fromUser: input.userLines?.has(claimKey(claim.text)) ?? false }));
    if (heading !== '' && claims.length > 0 && sections.length < SETUP_LIMITS.sections) {
      sections.push({ heading, claims, body: claimsBody(claims) });
    }
  }
  const mainRepo = input.answer.mainRepo ? pick(input.answer.mainRepo) : null;
  const quietRepos: SetupRepoPick[] = [];
  for (const raw of input.answer.quietRepos) {
    const repo = pick(raw);
    if (repo && repo.repo !== mainRepo?.repo && !quietRepos.some((entry) => entry.repo === repo.repo) && quietRepos.length < SETUP_LIMITS.quietRepos) {
      quietRepos.push(repo);
    }
  }
  return {
    sections,
    quietRepos,
    mainRepo,
    repos: input.repos,
    sources: input.sources,
    summary: clipText(input.answer.summary, SETUP_LIMITS.summaryChars),
    model: input.model,
  };
}

/**
 * The template when no agent draft came (no claude CLI, a failed call): the
 * usual headings with empty text, and the busiest repo as the main one.
 * The user writes the rest.
 */
export function blankSetupDraft(sources: SetupSource[], repos: SetupRepoCount[], reason: string): SetupDraft {
  const top = repos[0];
  return {
    sections: SETUP_HEADINGS.map((heading) => ({ heading, claims: [], body: '' })),
    quietRepos: [],
    mainRepo: top ? { repo: top.repo, why: `Most of your PRs in the last ${SETUP_ACTIVITY_DAYS} days (${top.prs}).`, sourceIds: [] } : null,
    repos,
    sources,
    summary: reason,
    model: null,
  };
}
