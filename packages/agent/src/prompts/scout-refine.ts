import type { ScoutRefineExample, ScoutRefineInput } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, viewerLine } from './shared.ts';
import { fileLine } from './scout-judge.ts';

/** Changed files listed per example; the matched ones are listed in full above them. */
const REFINE_FILES = 30;
/** Matching files listed per example. */
const REFINE_SIGNALS = 15;

/** One labeled example: the user's label and note outside the fence (their own words), the PR and the judge's reason inside it. */
function exampleSection(example: ScoutRefineExample): string {
  const signals = example.signals.slice(0, REFINE_SIGNALS).map((signal) => `${signal.changeType.toLowerCase()} ${signal.path} (hint ${signal.hint})`);
  const moreSignals = example.signals.length > signals.length ? `\n... and ${example.signals.length - signals.length} more matching files` : '';
  const files = example.files.slice(0, REFINE_FILES).map(fileLine);
  const moreFiles = example.files.length > files.length ? `\n... and ${example.files.length - files.length} more files` : '';
  const data = [
    `Title: ${example.title}`,
    `Description (start): ${example.bodyHead === '' ? '(none)' : example.bodyHead}`,
    `Files matching the path hints (${example.signals.length}):\n${signals.length === 0 ? 'none' : signals.join('\n')}${moreSignals}`,
    `Changed files (${example.files.length}):\n${files.join('\n')}${moreFiles}`,
    `The scout ${example.pulled ? 'pulled' : 'skipped'} it. Judge's reason: ${example.reason}`,
  ].join('\n');
  const label = example.label === 'want' ? (example.pulled ? 'WANT (keep pulling this)' : 'WANT (should have pulled this)') : 'NOISE (should not pull this)';
  const why = example.why === '' ? '' : `\nThe developer's note: ${clip(example.why, 200)}`;
  return `=== ${example.prKey}: ${label}${why}\n${githubData(data)}`;
}

/**
 * "Tighten" on the Scouts intro card: the developer labeled the dry run's
 * examples Want or Noise; revise the prompt and path hints so the scout
 * keeps the wanted PRs and drops the noise. The lessons of a real eval
 * (five rounds took a first draft from about 56 pulls a day to about 6
 * without losing a wanted PR) are in the rules: precision came mostly from
 * path hints and explicit "Skip ..." rules, and every tightening risked
 * dropping a wanted PR. The prompt and notes are the developer's own words;
 * the PRs and the judge's reasons are GitHub text and fenced.
 */
export function scoutRefinePrompt(input: ScoutRefineInput): string {
  const paths = input.paths.length === 0 ? '(none: the scout judges every PR)' : input.paths.join(', ');
  return `You tighten a "scout" a developer is setting up. A scout runs every hour over the repos it watches
and pulls in the few PRs from OTHER people that match its prompt, so the developer can weigh in before
they merge. It reads only the title, the start of the description and the changed file paths with
their change type and line counts; never diffs, code, comments or reviews.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
Repos it watches: ${input.repos.join(', ')}.
Scout "${clip(input.name, 80)}". Its prompt now, in the developer's words:

${clip(input.prompt, 3000)}

Its path hints now: ${paths}

How path hints work: gitignore-style globs over repo paths, matched segment by segment ("services/*/api/**",
"docs/architecture.md"). "+" in front counts only added files. "+*/" means a new top-level folder, and
"+products/*/" a new folder directly inside products/ (for any file added under products/, write
"+products/**"). Paths are a hard filter: a scout with hints never judges a PR that touches none of
them. No spaces, commas or notes inside a hint; at most 8 hints.

The developer ran the scout on recent PRs and labeled some of them:

${input.examples.map(exampleSection).join('\n\n')}

Revise the scout so it keeps pulling every WANT and stops pulling the NOISE. Rules, learned from tuning
scouts on real PRs:
- Prefer adding explicit "Skip ..." rules to the prompt (e.g. "Skip PRs that only bump versions or edit
  tests") and narrowing the path hints over rewording what the scout is for. Keep the developer's own
  sentences where they still hold.
- Every WANT example must still match at least one path hint (check its changed files against your
  hints) and fit the prompt. Losing a wanted PR is worse than keeping some noise.
- A developer's note on a label outranks your own guess about why they labeled it.
- Change only what the labels give a reason to change. When the labels give no clear pattern, keep the
  prompt and hints as they are and say so.
- Path hints must follow the syntax above; an invalid hint is dropped. An empty list turns the path
  filter off, so return one only when the hints themselves are the problem.

Answer:
- prompt: the whole revised prompt, plain sentences, no markdown, no lines starting with "##" or "repos:".
- paths: the whole revised list of path hints.
- summary: one or two plain sentences for the developer saying what changed and why, e.g. "Added a skip
  rule for test-only PRs and narrowed services/** to services/*/api/**, which every PR you wanted touches."
${jsonOnly('{"prompt": "...", "paths": ["+*/"], "summary": "..."}')}`;
}
