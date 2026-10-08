import type { GlanceBatchInput, GlanceBatchItem } from '../service.ts';
import { renderDossier } from './dossier.ts';
import { batchDetail, contextBlock, GITHUB_DATA_RULE, githubData, howItReached, jsonOnly, NO_CI_RULE, prDetails, viewerLine, workContextBlock } from './shared.ts';

function topicBlock(input: GlanceBatchInput): string {
  if (!input.topic) {
    return 'These PRs are not sorted into any topic yet.';
  }
  const prs = new Map(input.items.map((item) => [item.pr.key, item.pr]));
  const dossier = input.dossier ? renderDossier(input.dossier, prs) : `No dossier yet. ${input.topic.summary}`;
  // Topic name and dossier are written from GitHub text: fenced as data.
  return `They all belong to one topic. Its name and what is known about that work:\n\n${githubData(`Topic: ${input.topic.name}\n\n${dossier}`)}`;
}

/** On the retry batch: the first answer for these PRs could not be used. */
function retryNote(input: GlanceBatchInput): string {
  if (input.attempt !== 2) {
    return '';
  }
  return `\nA first answer for these pull requests could not be used: an entry was left out, a field was
missing, or the verdict was misspelled. Check each entry against the shape below before replying.`;
}

/** One glance entry, for the answer shapes of the glance batch and the topic digest. */
export const GLANCE_ENTRY_SHAPE =
  '{"prKey": "owner/repo#1", "verdict": "LOOKS_SAFE" | "LOOK_CLOSER" | "NOT_YOURS", "forYou": "...", "does": "...", "risk": "...", "othersSaid": "...", "keyFiles": [{"path": "src/app.ts", "why": "..."}], "riskBasis": "checked: ..." | "not checked: ...", "verdictBasis": "checked: ..." | "not checked: ..."}';

/**
 * What "checked" means for riskBasis and verdictBasis (DESIGN.md "Glance
 * claim basis"). The agent never sees the code, only the changed files
 * list, the description, reviews and comments, so "checked" can only mean
 * the claim follows from those. A mismatch between description and files
 * was stated as fact on a stacked PR whose list held its parent's changes
 * (2026-10-08): such a mismatch must be marked not checked unless it is.
 */
export const CLAIM_BASIS_RULE = `What you were given per PR is its description, the list of changed files with line counts,
review states and some comments; never the code itself. A claim is "checked" only when it follows
directly from those: a listed file, a review state, a comment. What the code does beyond file
names, or anything taken from the description alone, is "not checked", for example
"not checked: inferred from the description" or "not checked: files list cut off".
The changed files can hold another PR's changes when this one is built on it: when the
description names a PR this one is stacked on or depends on, files outside its description are
no mismatch you checked. Never state a mismatch between the description and the changes as a
fact unless you checked it; otherwise say it may be so and mark it not checked.`;

/** What merging the PR does to the declared layer below, by that layer's state. */
function declaredMergeLine(parent: string, state: string, shared: boolean): string {
  if (state === 'merged') {
    return `${parent} has merged already; GitHub's diff here can still show its changes until this PR's branch is updated.`;
  }
  if (state === 'closed') {
    return `${parent} was closed without merging, yet its changes may still be in this PR: merging this PR would land them.`;
  }
  if (shared) {
    return `So GitHub's diff and changed files here include ${parent}'s changes, and merging this PR also lands ${parent}.`;
  }
  return `It shares none of its commits with ${parent}, so its diff may not include ${parent}'s changes; if it does, merging this PR also lands ${parent}.`;
}

/**
 * For a PR whose description declares the layer below while its base is no
 * PR's branch (DESIGN.md "Stacks declared in the body"): GitHub's diff then
 * holds that layer's changes too, which reads like a description that
 * leaves things out. Empty for every other PR.
 */
export function declaredParentBlock(item: GlanceBatchItem): string {
  const note = item.declaredParent;
  if (!note) {
    return '';
  }
  const parent = `#${note.number}`;
  // Unknown commits (none stored) read as shared: the description says so, nothing says otherwise.
  const shared = note.commits === 0 || note.sharedCommits > 0;
  const lines = [
    `Stack declared in the description: it names ${parent} (${note.state}) as the PR below it, but its base is no PR's branch (see Base above).`,
    declaredMergeLine(parent, note.state, shared),
  ];
  if (note.sharedCommits > 0) {
    lines.push(`${note.sharedCommits} of its ${note.commits} commits are also ${parent}'s.`);
  }
  if (note.sharedFiles.length > 0) {
    const files = note.sharedFiles.slice(0, batchDetail.files).join('\n');
    lines.push(`Changed files here that ${parent} changes too, so likely from ${parent}:\n${githubData(files)}`);
  }
  lines.push(
    `Judge this PR's own layer: changes its description leaves out may come from ${parent} and are no mismatch. ` +
      `While ${parent} is not merged, say in forYou that merging this PR also lands ${parent}.`,
  );
  return `\n${lines.join('\n')}`;
}

/**
 * For a PR whose description says it depends on another PR that is no
 * layer below it (no commit in common known): a merge order, not a stack.
 * Empty for every other PR.
 */
export function dependsOnBlock(item: GlanceBatchItem): string {
  const note = item.dependsOn;
  if (!note) {
    return '';
  }
  const other = `#${note.number}`;
  if (note.state === null) {
    return `\nMerge order declared in the description: it depends on ${other}, which should merge first. PostPile knows of no commits they share, so treat it as no stack.`;
  }
  return (
    `\nMerge order declared in the description: it depends on ${other} (${note.state}), which should merge first. ` +
    `They share no commits PostPile knows of, so this is no stack and ${other}'s changes are not in this PR's diff.`
  );
}

/** The pull requests, each headed by its key, with how it reached the user. */
export function glanceSections(input: GlanceBatchInput): string {
  return input.items
    .map(
      (item) =>
        `=== ${item.pr.key}\nHow it reached them: ${howItReached(item.provenance)}\n${prDetails(item.pr, input.viewer, batchDetail)}${declaredParentBlock(item)}${dependsOnBlock(item)}`,
    )
    .join('\n\n');
}

/**
 * The glance fields, word limits and rules, the same in the glance batch
 * and the topic digest.
 */
export function glanceRules(input: GlanceBatchInput): string {
  return `For every pull request above give one entry, with its key as prKey. Fields, each read at a glance,
so stay under the word limits:
- verdict: LOOKS_SAFE means a reasonable reviewer could approve from this summary alone.
  LOOK_CLOSER means something deserves a real read first: open concerns, risky changes, or a
  description that does not explain the change. NOT_YOURS means the change is clearly outside
  what this user should sign off, judged by their instructions above. For a PR that already
  merged without this user's review, judge after the fact: LOOK_CLOSER means they should look
  now (say in forYou what they would have pushed back on), LOOKS_SAFE means nothing to follow up,
  NOT_YOURS as above.
- forYou: one or two sentences on what this PR means for this user specifically, written
  against their own instructions and what they care about in this topic. Say what they should
  do. Max 40 words.
- does: what the PR does and why, and its part in the topic when that helps, max 30 words.
- risk: "low", "medium" or "high", then " - " and what could break, max 15 words.
- othersSaid: which humans weighed in and whether any concern is still open, max 25 words;
  "nobody yet" if no human commented.
- keyFiles: up to 3 files a reviewer should open first, most important first, each as
  {"path", "why"}. Pick only from the PR's "Changed files" above and copy the path exactly;
  why is max 12 words (what to look for there). Give [] when the PR is trivial or lists no files.
- riskBasis: how you know the risk line. "checked: " and what you checked it against, or
  "not checked: " and why not, max 6 words after the colon.
- verdictBasis: the same for the reason behind the verdict (what forYou and risk give as the
  reason to look closer, or why it looks safe or is not theirs).

${CLAIM_BASIS_RULE}

"Approved by" marks each approver as a person or an agent (an AI review agent or other
automation account). Both are real approvals on GitHub. Who looked is a fact you may use in the
verdict, forYou or risk, for example whether a person has reviewed a change in the user's areas.

${NO_CI_RULE}

Judge each PR on its own facts; do not copy one PR's verdict to the next. Be concrete and
skeptical; say "unclear" rather than invent.
Give exactly ${input.items.length} ${input.items.length === 1 ? 'entry' : 'entries'}, one per pull request above, also for the user's own
PRs and drafts. Copy each prKey exactly as it appears after "===", and spell the verdict exactly
as one of LOOKS_SAFE, LOOK_CLOSER, NOT_YOURS.${retryNote(input)}`;
}

/**
 * The "approve at a glance" summary for up to GLANCE_BATCH_SIZE PRs of one
 * topic in one call. The dossier and the user's memory are sent once; each PR
 * is read against them. Same fields and word limits as the single glance.
 */
export function glanceBatchPrompt(input: GlanceBatchInput): string {
  return `You are helping a developer decide, at a glance, what to do about each of ${input.items.length} GitHub pull requests.
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
${topicBlock(input)}

The pull requests, each headed by its key:

${glanceSections(input)}

${glanceRules(input)}
${jsonOnly(`{"glances": [${GLANCE_ENTRY_SHAPE}]}`)}`;
}
