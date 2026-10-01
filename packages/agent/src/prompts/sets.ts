import type { Pr, PrSet } from '@postpile/core';
import { activeSets, unplacedKeys } from '../set-answer.ts';
import type { SetGroupingInput } from '../service.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, prLine, WORK_GLOSSARY } from './shared.ts';

function riskNote(input: SetGroupingInput, pr: Pr): string {
  const risk = input.risks[pr.key];
  return risk ? `risk: ${clip(risk, 160)}` : 'risk: not judged yet';
}

/** One line per member, merged ones too: the tile keeps them, and the take covers them. */
function memberLines(input: SetGroupingInput, set: PrSet, prs: Map<string, Pr>): string {
  return set.members
    .map((member) => {
      const pr = prs.get(member.prKey);
      const line = pr ? prLine(pr) : member.prKey;
      return `  - ${line}\n    ${pr ? riskNote(input, pr) : ''}; joined because: ${clip(member.reason, 200)}`;
    })
    .join('\n');
}

function setBlock(input: SetGroupingInput, set: PrSet, prs: Map<string, Pr>): string {
  const removed =
    set.removedKeys.length > 0
      ? `\n  the user said NOT related, never group again with the PRs above: ${set.removedKeys.join(', ')}`
      : '';
  return `- set id ${set.id}
${githubData(`  title: ${set.title}\n  take: ${set.take}\n${memberLines(input, set, prs)}`)}${removed}`;
}

function dissolvedLine(set: PrSet): string {
  return `- ${set.members.map((member) => member.prKey).join(', ')}`;
}

function unplacedBlock(input: SetGroupingInput, prs: Map<string, Pr>): string {
  const lines = unplacedKeys(input).flatMap((key) => {
    const pr = prs.get(key);
    if (!pr) {
      return [];
    }
    const files = pr.files.slice(0, 6).map((f) => f.path).join(', ');
    return [`${prLine(pr)}\n  ${riskNote(input, pr)}\n  ${clip(pr.body, 300) || '(no description)'}${files ? `\n  files: ${files}` : ''}`];
  });
  return lines.length === 0 ? '(none)' : githubData(lines.join('\n\n'));
}

/** The topic's current sets, the dissolved groupings and the open PRs in no set. */
export function setGroupingSections(input: SetGroupingInput): string {
  const prs = new Map(input.prs.map((pr) => [pr.key, pr]));
  const active = activeSets(input);
  const current = active.length === 0 ? '(none yet)' : active.map((set) => setBlock(input, set, prs)).join('\n');
  const dissolved = input.existingSets.filter((set) => set.status === 'dissolved');
  const dissolvedText = dissolved.length === 0 ? '' : `\nGroupings the user dissolved. Never propose them again:\n${dissolved.map(dissolvedLine).join('\n')}\n`;
  return `Current sets (lasting: they stay as they are unless you change them below):
${current}
${dissolvedText}
Open PRs in no set yet:
${unplacedBlock(input, prs)}`;
}

/** The set answer's lists, for the answer shapes of the set prompt and the topic digest. */
export const SET_ANSWER_FIELDS = `"joins": [{"setId": "...", "prKey": "owner/repo#1", "reason": "..."}],
 "newSets": [{"title": "...", "take": "...", "members": [{"prKey": "owner/repo#2", "reason": "..."}]}],
 "leaves": [{"setId": "...", "prKey": "owner/repo#3", "reason": "..."}],
 "merges": [{"setId": "...", "intoSetId": "...", "reason": "..."}],
 "updates": [{"setId": "...", "title": "...", "take": "..."}]`;

/** What a set is and how to answer, the same in the set prompt and the topic digest. */
export const SET_RULES = `What a set is:
- Two or more PRs that one judgement covers: once the developer has read or approved one, they know
  what the others are. The same change or pattern in several places (the same fix in several
  repos, the same version bump, one codemod split up), or one small piece of the goal done in steps.
- Similar risk. Never put a PR whose risk is high next to low-risk ones: the developer could not
  handle them in one go. Prefer PRs from the same kind of author (a bot, a coding agent, a person).
- Being in the same topic is not enough: the topic already groups the whole goal.
- Never group by status, by whose move it is, by review state or by what is unread. Those change
  by the hour; sets stay.
- Stacked PRs (one's base branch is another's head branch) are already one tile; do not make a set
  of one stack's layers alone.

Sets are lasting. Answer only with what changes; anything you leave out stays as it is:
- joins: put an open PR above into a current set when the same judgement covers it.
- newSets: two or more open PRs above that belong together and fit no current set.
- leaves: take a PR out of a set only with evidence that it no longer fits: its risk changed and
  no longer matches the others, or the user's corrections say so. Name that evidence in reason.
  Never take out a PR because it merged or closed: the set keeps its finished PRs.
- merges: two current sets that have become one piece of work; setId goes into intoSetId.
- updates: a new title or take for a current set, only when its members changed.
- title: 2 to 6 words naming the shared change. take: one sentence on what one approval covers,
  for example "Same one-line version cap in four repos". reason: one short sentence per PR.
- A PR goes into one set at most. Copy set ids and PR keys exactly as above.
- Changing nothing is the most common good answer.`;

/**
 * Keeps the topic's sets: lasting tiles of PRs that one judgement covers
 * (DESIGN.md "Tiles hold still"). The agent answers only with changes:
 * place new PRs, move one out with evidence, merge two sets that became
 * one piece of work. Anything it leaves out stays. Status, turn and review
 * state change by the hour and never decide a set.
 */
export function setGroupingPrompt(input: SetGroupingInput): string {
  return `You keep the tiles of one topic for a developer. A tile is how the developer handles PRs in one go.
Most PRs are a tile of their own. A set is a tile of two or more PRs.
${WORK_GLOSSARY}
The topic, as written from GitHub activity:
${githubData(`${input.topic.name}\n${input.topic.summary}`)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
${setGroupingSections(input)}

${SET_RULES}
${NO_CI_RULE}
${jsonOnly(`{${SET_ANSWER_FIELDS}}`)}`;
}
