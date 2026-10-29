import type { ScoutFile } from '@postpile/core';
import type { ScoutJudgeInput, ScoutJudgeItem } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, viewerLine } from './shared.ts';

/** Changed files listed per PR; the matched ones are always listed in full above them. */
export const SCOUT_JUDGE_FILES = 40;
/** Matching files listed per PR; a broad hint on a big PR can match thousands. */
export const SCOUT_JUDGE_SIGNALS = 20;
/** Base folders listed per PR. */
const SCOUT_JUDGE_FOLDERS = 60;

/** "billing/main.ts (added, +12/−0)": lines added to a file read apart from a removal. Counts only when GitHub gave them. */
function fileLine(file: ScoutFile): string {
  const lines = file.additions === undefined || file.deletions === undefined ? '' : `, +${file.additions}/−${file.deletions}`;
  return `${file.path} (${file.changeType.toLowerCase()}${lines})`;
}

function itemSection(item: ScoutJudgeItem): string {
  const state = item.state === 'OPEN' ? 'open' : item.state.toLowerCase();
  const shownSignals = item.signals.slice(0, SCOUT_JUDGE_SIGNALS).map((signal) => `${signal.changeType} ${signal.path} (hint ${signal.hint})`);
  const moreSignals = item.signals.length > shownSignals.length ? `\n... and ${item.signals.length - shownSignals.length} more matching files` : '';
  const signals = item.signals.length === 0 ? 'none' : `${shownSignals.join('\n')}${moreSignals}`;
  const shown = item.files.slice(0, SCOUT_JUDGE_FILES).map(fileLine);
  const more = item.files.length > shown.length ? `\n... and ${item.files.length - shown.length} more files` : '';
  const folders = item.baseFolders.slice(0, SCOUT_JUDGE_FOLDERS).join(', ');
  // Everything below comes from GitHub, file paths included: fenced.
  const data = [
    `${item.prKey} (${state}, by @${item.author})`,
    `Title: ${item.title}`,
    ...(item.stackedOn === null ? [] : [`Stacked on ${item.stackedOn.base}, not ${item.stackedOn.defaultBranch}`]),
    `Description (start): ${item.bodyHead === '' ? '(none)' : item.bodyHead}`,
    `Files matching the scout's path hints (${item.signals.length}):\n${signals}`,
    `Changed files (${item.files.length}):\n${shown.join('\n')}${more}`,
    `Folders of the base branch the path hints look in: ${folders === '' ? '(none read)' : folders}`,
  ].join('\n');
  return `=== ${item.prKey}\n${githubData(data)}`;
}

/**
 * A scout of the user's (scouts.md) asks which PRs from outside their
 * GitHub inbox they should see. The scout's prompt is the user's own text;
 * the PRs are GitHub text and fenced. Pull only what clearly matches: a
 * pulled PR shows in the app with this reason, a skipped one costs nothing.
 */
export function scoutJudgePrompt(input: ScoutJudgeInput): string {
  const sections = input.items.map(itemSection).join('\n\n');
  return `You are a scout for a developer. They want to see some pull requests that never reach their GitHub
notifications, so they can weigh in before those PRs merge. Below is what this scout looks for, in
the developer's own words, and a batch of recent PRs from the repos it watches.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
Scout "${clip(input.scout.name, 80)}". What to pull in, in the developer's words:

${clip(input.scout.prompt, 3000)}

Pull a PR only when it clearly matches what the scout asks for, judged from its title, description
and changed files. When in doubt, skip: a pulled PR asks for the developer's time. Path hints are
a first cut the developer wrote; a match is a reason to look, not a reason to pull. "+*/" means a new
top-level folder, and "+products/*/" a new folder directly inside products/: an added file in a
folder that is not among the base branch's folders listed for that PR. A PR "Stacked on" another
branch is one layer of a stack: its folders are those of the default branch, so a folder a lower
layer adds still counts as new. Each changed file shows its
change and its lines added and removed, so lines added to an existing file read apart from a removal.

${sections}

For each PR answer:
- verdict: "pull" or "skip".
- reason: one short line in plain words, at most 140 characters, saying what in the PR matches the
  scout (for a pull, e.g. "adds a new top-level folder billing/ with its own service") or why not.
${NO_CI_RULE}
Answer every PR above exactly once, with its key as written after "===".
${jsonOnly('{"judgements": [{"prKey": "owner/repo#123", "verdict": "pull", "reason": "..."}]}')}`;
}
