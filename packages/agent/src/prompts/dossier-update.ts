import { DOSSIER_LIMITS } from '@postpile/core';
import type { Fact, PrEvent } from '@postpile/core';
import type { DossierRefs, UserSource } from '../dossier-refs.ts';
import type { DossierUpdateInput } from '../service.ts';
import { renderDossier } from './dossier.ts';
import { clip, contextBlock, entityText, GITHUB_DATA_RULE, githubData, jsonOnly, NO_CI_RULE, prLine, viewerLine, withoutCi, WORK_GLOSSARY, workContextBlock } from './shared.ts';

function factLine(fact: Fact, shortId: string, staleNote: string): string {
  const since = fact.validFrom.slice(0, 10);
  return `- ${shortId} [${fact.predicate}] ${entityText(fact.subject)} -> ${entityText(fact.object)}: ${fact.text} (since ${since})${staleNote}`;
}

function eventLine(event: PrEvent, shortId: string): string {
  return `- ${shortId} ${event.at.slice(0, 10)} ${event.prKey} ${event.kind} by @${event.actor}: ${clip(event.summary, 300)}`;
}

/** Bots are most of the volume and none of the story: one count per PR. CI results are left out (NO_CI_RULE). */
function botCounts(events: PrEvent[]): string[] {
  const byPr = new Map<string, { count: number; kinds: Set<string> }>();
  for (const event of withoutCi(events).filter((e) => e.isBot)) {
    const entry = byPr.get(event.prKey) ?? { count: 0, kinds: new Set<string>() };
    entry.count += 1;
    entry.kinds.add(event.kind);
    byPr.set(event.prKey, entry);
  }
  return [...byPr].map(([prKey, entry]) => `- ${prKey}: ${entry.count} (${[...entry.kinds].join(', ')})`);
}

function block(title: string, lines: string[], empty: string | null = null): string {
  if (lines.length === 0) {
    return empty === null ? '' : `\n${title}\n${empty}\n`;
  }
  return `\n${title}\n${lines.join('\n')}\n`;
}

/** A block of lines copied from GitHub, fenced so the model reads them as data. */
function dataBlock(title: string, lines: string[], empty: string | null = null): string {
  if (lines.length === 0) {
    return block(title, lines, empty);
  }
  return `\n${title}\n${githubData(lines.join('\n'))}\n`;
}

function eventsBlock(input: DossierUpdateInput, refs: DossierRefs): string {
  const human = input.delta.events.flatMap((event) => {
    const shortId = refs.eventShortId(event);
    return shortId ? [eventLine(event, shortId)] : [];
  });
  const omitted =
    input.delta.omittedEvents > 0 ? `(${input.delta.omittedEvents} older events were left out to keep this short)\n` : '';
  const title =
    input.delta.joinedPrKeys.length > 0
      ? 'New activity since the last update, and the history of PRs that just joined, oldest first:'
      : 'New activity since the last update, oldest first:';
  return (
    dataBlock(title, human, '(no new human activity)') +
    omitted +
    block('Bot activity, counted only:', botCounts(input.delta.events))
  );
}

function joinedBlock(input: DossierUpdateInput): string {
  const joined = new Set(input.delta.joinedPrKeys);
  const intros = input.prs
    .filter((pr) => joined.has(pr.key))
    .map((pr) => {
      const files = pr.files.slice(0, 5).map((f) => f.path).join(', ');
      return `- ${prLine(pr)}\n  ${clip(pr.body, 300) || '(no description)'}${files ? `\n  files: ${files}` : ''}`;
    });
  return dataBlock('PRs that just joined the topic (the dossier does not know them yet):', intros);
}

function factsBlocks(input: DossierUpdateInput, refs: DossierRefs): string {
  const known = input.knownFacts.map((f) => factLine(f, refs.factShortId(f) ?? '', ''));
  const stale = input.staleFacts.map((f) => factLine(f, refs.factShortId(f) ?? '', ` (check failed: ${f.staleReason ?? 'unknown'})`));
  // Facts are extracted from GitHub text, so they stay fenced like it.
  return (
    dataBlock('Known facts (checked against GitHub, context only):', known) +
    dataBlock('Facts that failed a check. For each one: confirm it, close it, or state the corrected fact:', stale)
  );
}

/**
 * Open members, and closed ones the dossier or this update is about. Other
 * merged or closed PRs are only counted, so the prompt does not grow with
 * the age of the topic.
 */
function membersBlock(input: DossierUpdateInput): string {
  const named = new Set([...(input.previous?.dossier.timeline.map((entry) => entry.prKey) ?? []), ...input.delta.joinedPrKeys]);
  const shown = input.prs.filter((pr) => pr.state === 'OPEN' || named.has(pr.key));
  const hidden = input.prs.length - shown.length;
  const lines = shown.map((pr) => `- ${prLine(pr)}`);
  const more = hidden > 0 ? `(and ${hidden} more merged or closed PRs)\n` : '';
  return dataBlock('Member PRs now:', lines, '(none)') + more;
}

function userSourceLine(source: UserSource): string {
  const { shortId, ref } = source;
  if (ref.kind === 'instructions') {
    return `- ${shortId} their general instructions above${ref.id ? ` (version ${ref.id})` : ''}`;
  }
  if (ref.kind === 'tailoring') {
    return `- ${shortId} their instruction for this topic: ${clip(ref.quote, 300)}`;
  }
  if (ref.kind === 'feedback') {
    return `- ${shortId} ${ref.at.slice(0, 10)} correction: ${clip(ref.quote, 300)}`;
  }
  return `- ${shortId} ${ref.at.slice(0, 10)} said in chat: ${clip(ref.quote, 500)}`;
}

/**
 * The user's own words as citable sources. Chat turns are new content here:
 * what the user said about this topic since the last version.
 */
function userSourcesBlock(refs: DossierRefs): string {
  const lines = refs.userSources().map(userSourceLine);
  return block("Sources in the user's own words (instructions, topic instructions, corrections, chat). Cite them by id:", lines);
}

/** How the topic reaches the user, what the rules made of it, and the areas to reuse. */
function placementBlock(input: DossierUpdateInput): string {
  const signals = input.relationSignals;
  const verdict = signals.relation
    ? `Rules decided: ${signals.relation} (why: ${signals.whyYou}). Use exactly that.`
    : `Rules could not decide between team and routed. Best guess for why: ${signals.whyYou}.`;
  const areas = input.areas.length === 0 ? '(none yet)' : input.areas.map((area) => `${area.name} (${area.topics})`).join(', ');
  return block('How this topic reaches the user:', [
    ...signals.notes.map((note) => `- ${note}`),
    `- ${verdict}`,
    `- current area: ${input.currentArea ?? '(none)'}; areas in use: ${areas}`,
  ]);
}

function feedbackBlock(input: DossierUpdateInput): string {
  const lines = input.delta.newFeedback.map((f) => `- ${f.createdAt.slice(0, 10)} ${f.kind}${f.prKey ? ` (${f.prKey})` : ''}: ${clip(f.note, 300)}`);
  return block('New corrections from the user since the last version. Take them into the dossier:', lines);
}

const answerShape = `{
  "dossier": {
    "goal": "...", "goalRefs": ["owner/repo#1"],
    "summary": "...", "status": "starting" | "active" | "blocked" | "winding_down" | "finished",
    "statusNote": "...", "statusRefs": ["e4"],
    "people": [{"login": "alice", "role": "driver" | "contributor" | "reviewer" | "stakeholder", "note": "..."}],
    "openQuestions": [{"text": "...", "askedBy": "carol" | null, "refs": ["e3"]}],
    "timeline": [{"prKey": "owner/repo#1", "role": "...", "refs": ["owner/repo#1"]}],
    "earlier": "...",
    "userCares": [{"text": "...", "source": "instructions" | "tailoring" | "feedback" | "observed", "refs": ["T1"]}],
    "recentChanges": [{"text": "...", "refs": ["e5", "C1"]}],
    "relation": {"kind": "team" | "routed" | "fyi", "ownerTeam": "org/team" | null, "whyYou": "...", "refs": ["e2"]}
  },
  "area": "CI",
  "flags": [{"kind": "needs_user" | "contradiction" | "looks_finished" | "off_topic_pr", "text": "...", "prKey": "owner/repo#1" | null}],
  "facts": [{"subject": {"kind": "person", "key": "alice"}, "predicate": "works_on", "object": {"kind": "pr", "key": "owner/repo#1"} | null, "text": "...", "refs": ["e2"]}],
  "closeFacts": [{"factId": "F2", "reason": "..."}],
  "confirmedFactIds": ["F7"]
}`;

/**
 * REFINE: the previous dossier plus only what is new since it was written.
 * The model rewrites the whole dossier, reports flags, and extracts facts
 * with short-id refs; the service maps refs back and drops unknown ids.
 */
export function dossierUpdatePrompt(input: DossierUpdateInput, refs: DossierRefs): string {
  const limits = DOSSIER_LIMITS;
  const prsByKey = new Map(input.prs.map((pr) => [pr.key, pr]));
  // The previous dossier was written from GitHub text: data, not instructions.
  const previous = input.previous ? githubData(renderDossier(input.previous, prsByKey)) : 'None yet. This is the first write-up of the topic.';
  const left = input.delta.leftPrKeys.map((key) => `- ${key}`);
  const claims = input.delta.staleClaims.map((c) => `- ${c.path}: ${c.reason}`);
  return `You keep a living dossier on one piece of ongoing work, the topic with id ${input.topic.id},
for a developer who follows it on GitHub. You get the previous dossier and only what happened
since. Rewrite the dossier so it is true now. The topic's current name:
${githubData(input.topic.name)}
${WORK_GLOSSARY}
${viewerLine(input.viewer)}
${GITHUB_DATA_RULE}
${contextBlock(input.context)}${workContextBlock(input.context)}
Previous dossier:
${previous}
${membersBlock(input)}${joinedBlock(input)}${eventsBlock(input, refs)}${userSourcesBlock(refs)}${block('PRs that left the topic (drop them from the timeline, mention in earlier if they mattered):', left)}${placementBlock(input)}${factsBlocks(input, refs)}${dataBlock('Claims in the previous dossier that failed a check (fix or drop them):', claims)}${feedbackBlock(input)}
How to write the dossier:
- Keep what is still true, change what moved, drop what is over. Plain words, no filler.
- Every field is read by the user as a fact about the work. Never write about the dossier itself
  ("First write-up", "Initial dossier", "Updated with new activity", "No changes").
- statusNote is the one-line state shown next to the topic name: short, concrete, about the work
  ("waiting on lyra's review of the cache PR"), max ${limits.statusNote} chars.
- goal: what the initiative is for, max ${limits.goal} chars. summary: where it stands, max ${limits.summary}.
- status and statusNote (max ${limits.statusNote}): why that status.
- people: max ${limits.people}, the driver first; note max ${limits.personNote} chars. Logins without "@".
- openQuestions: max ${limits.openQuestions}, only questions still open; text max ${limits.questionText}.
- timeline: member PRs only, oldest first, role = what the PR does for the initiative, max
  ${limits.timelineRole} chars. Max ${limits.timeline} entries; fold older ones into earlier (max ${limits.earlier}).
  Do not write PR state or reviewers anywhere: those are read from GitHub at display time.
- userCares: max ${limits.userCares}, what this user cares about in this topic, judged by their
  instructions and corrections; text max ${limits.careText}. source says where it comes from;
  GitHub activity is never a source for what the user cares about.
- recentChanges: newest first, max ${limits.recentChanges}, text max ${limits.changeText}. Add entries for
  what happened now, keep older ones that still matter (same text, or cite their C id).
- refs: the short ids above: e1.. for new activity, Q1.. or C1.. to keep the sources of an entry
  of the previous dossier, F1.. for a fact, a member PR key, or I1 / T1.. / U1.. / M1.. for the
  user's own words. Every line carries refs: goalRefs, statusRefs, each question, timeline entry,
  care and change. Cite only what the line rests on, at most 3. A line you keep unchanged may
  leave refs empty; it keeps its old sources. Only an observed care may cite activity.

${NO_CI_RULE}

relation: how this topic relates to the user. "team" when their own team drives the work,
"routed" when another team owns it and the user or their team was pulled in for their angle (a
review for CI, CODEOWNERS), "fyi" when they only follow along. ownerTeam: the owning team as
"org/team" when you can tell, else null. whyYou: short, concrete, max ${limits.whyYou} chars ("team-devex review
requested on .github/workflows", "subscribed"). When the rules decided, use their answer.

area: the part of the product or codebase the topic's work touches, 1 to 3 words ("Hogland",
"Data warehouse", "posthog-cli"). Never the user's own field or team ("Dev tooling", "DevEx"):
every topic they see would fit it. Reuse an area in use when the work touches that part; replace
the current area when it is such a catch-all or no longer fits; a new one when no area in use
names that part.

flags: needs_user when the user should act or decide something; contradiction when new activity
contradicts the dossier or a fact; looks_finished when the work seems done; off_topic_pr (with
prKey) when a member PR fails the topic test above: it neither serves the goal nor came out
of that work. Usually empty.

facts: short statements worth remembering across topics, only when new or changed by the
activity above. Each needs at least one ref. Entities: person (login, lowercase), pr
(owner/repo#123), path ("owner/repo:dir/prefix/"), initiative (use "${input.topic.id}").
Predicates: drives (person -> initiative), works_on / reviews (person -> pr or path), owns
(person -> path), part_of (pr -> initiative), depends_on (pr -> pr), blocked_by (pr or
initiative -> pr or person), decided / status / note (object null, the text says it).
Do not repeat a known fact unless it changed.

closeFacts: known or failed facts (F ids) that are no longer true. confirmedFactIds: failed facts
that are still true.
${jsonOnly(answerShape)}`;
}
