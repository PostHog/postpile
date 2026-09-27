import type { PrSet } from '@code-manager/core';
import type { SetGroupingInput } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, prLine } from './shared.ts';

function setLine(set: PrSet): string {
  const members = set.members.map((m) => m.prKey).join(', ');
  const status = set.status === 'dissolved' ? ' (DISSOLVED by the user, do not propose it again)' : '';
  const removed =
    set.removedKeys.length > 0
      ? `\n  the user said NOT related, never group again with the PRs above: ${set.removedKeys.join(', ')}`
      : '';
  return `- "${set.title}"${status}: ${members}${removed}`;
}

/**
 * Groups related PRs inside one topic that git does not stack. Dissolved sets
 * and "not related" corrections are in the prompt so the agent does not keep
 * proposing a grouping the user already rejected.
 */
export function setGroupingPrompt(input: SetGroupingInput): string {
  const prs = input.prs
    .map((pr) => {
      const files = pr.files.slice(0, 6).map((f) => f.path).join(', ');
      return `${prLine(pr)}\n  ${clip(pr.body, 300) || '(no description)'}${files ? `\n  files: ${files}` : ''}`;
    })
    .join('\n\n');
  const existing = input.existingSets.length === 0 ? '(none)' : input.existingSets.map(setLine).join('\n');
  return `You are grouping related GitHub pull requests inside the topic "${input.topic.name}" so a
developer can review them together. ${input.topic.summary}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
Pull requests in the topic:

${githubData(prs)}

Current sets:
${existing}

Rules:
- A set is two or more PRs that make most sense read together: same change split across repos,
  a feature and its follow-up, a migration and its cleanup. Being in the same topic is not enough.
- Stacked PRs (one's base branch is another's head branch) are handled elsewhere; do not set them.
- A PR may appear in more than one set, but only when it genuinely belongs to both.
- Keep current sets that still hold, with the same title. Never bring back a dissolved one.
- take: one or two sentences on what the set is doing as a whole.
- Per member, reason: one short sentence on why it belongs.
- No sets is a perfectly good answer.
${jsonOnly('{"sets": [{"title": "...", "take": "...", "members": [{"prKey": "owner/repo#1", "reason": "..."}]}]}')}`;
}
