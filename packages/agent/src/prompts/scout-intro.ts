import type { ScoutCheckInput, ScoutDraftInput } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, viewerLine, workContextBlock } from './shared.ts';

/** Active topic names the draft sees at most. */
const DRAFT_TOPICS = 30;

/** What a scout reads, said the same way to both intro calls. */
const WHAT_A_SCOUT_READS = `A scout runs every hour over the repos it watches. For each recently updated PR it reads only the
title, the first 600 characters of the description, and the changed file paths with their change
type (added, modified, removed, renamed). It never reads diffs, code, comments or reviews. It pulls
in the few PRs that match its prompt, so the developer can weigh in before they merge.`;

/**
 * The intro card's first draft of a scout prompt, from the user's own
 * instructions and their work context. Topic names are agent-written from
 * GitHub text: fenced.
 */
export function scoutDraftPrompt(input: ScoutDraftInput): string {
  const topics = input.topics.slice(0, DRAFT_TOPICS).join('\n');
  return `You draft a first "scout" for a developer: a short prompt saying which pull requests from OTHER
people, outside their GitHub notifications, they would want to see before those merge.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
${WHAT_A_SCOUT_READS}

Repos it would watch: ${input.repos.join(', ') || '(not chosen yet)'}.
Topics the developer follows now:
${githubData(topics === '' ? '(none yet)' : topics)}

Write the prompt in plain words, two to four sentences, as the developer would: what kind of change to
pull in, judged from titles, descriptions and file paths, and what to skip. Pick what their
instructions say they care about across teams; never their own team's day-to-day work, which
already reaches them. No markdown, no lists, no repo names.
${jsonOnly('{"prompt": "PRs from other teams that ..."}')}`;
}

/**
 * "Check scout": does the prompt fit what a scout reads, which part (at most
 * one) it cannot see, a short name, and path hints. The prompt is the
 * user's own words, not GitHub text.
 */
export function scoutCheckPrompt(input: ScoutCheckInput): string {
  return `You check a "scout" a developer wrote before it is turned on.
${viewerLine(input.viewer)}
${contextBlock(input.context)}
${WHAT_A_SCOUT_READS}

Repos it will watch: ${input.repos.join(', ')}.
The scout's prompt, in the developer's words:

${clip(input.prompt, 3000)}

Answer:
- fit: "fits" when what it asks for shows in titles, descriptions or changed paths; "partly" when some
  of it does; "no" when almost none of it does.
- note: one sentence for the developer saying why, in plain words.
- cantSee: the one part of the prompt a scout can't see (it would need the code or the discussion), or
  null. part: quoted exactly from the prompt, word for word, so it can be cut out. why: one sentence.
- name: a short name for the scout, two to four words, e.g. "Lookout · structure".
- paths: up to 6 path hints, as gitignore-style globs over repo paths ("services/*/api/**",
  "docs/architecture.md"). Put "+" in front to count only added files. "+*/" means "adds a new
  top-level folder", and "+products/*/" means "adds a new folder directly inside products/" (not
  any file added somewhere under products/; for that, write "+products/**"). Paths are a hard filter: a scout with paths never judges a PR that touches none
  of them. So the hints together must cover EVERY kind of PR the prompt asks for. If one part of the
  prompt can't be pinned to paths ("changes to the public API shape" spread over many files), return
  [] instead: a missing hint only costs a model call, a partial list silently narrows the scout.
- pathsCoverAll: true only when the paths cover every kind of PR the prompt asks for; false when
  unsure. With false, no paths are used.
${jsonOnly('{"fit": "fits", "note": "...", "cantSee": {"part": "...", "why": "..."}, "name": "...", "paths": ["+*/"], "pathsCoverAll": true}')}`;
}
