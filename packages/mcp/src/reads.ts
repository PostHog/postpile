// The four read tools, as plain functions over the engine's read methods.
// Nothing here writes, syncs or calls an agent.
import { formatDossier, formatFacts, parsePrKey, type PrDetail, type PrKey, type TileView, type TopicDetail, type TopicListItem } from '@postpile/core';
import type { EngineService } from '@postpile/engine';
import { parsePrInput } from './pr-input.ts';
import { answer, day, freshness, glanceLines, prSummaryLine, stateWord, tileLine, turnText, whatsNewText, withActor } from './text.ts';

/** The read methods the tools use; the read-only engine and the sample-data engine both have them. */
export type PostPileReader = Pick<EngineService, 'getPr' | 'getTopic' | 'listTopics' | 'search' | 'getViewer' | 'lastSyncReport'>;

export interface ToolAnswer {
  text: string;
  /** False when the PR, topic or search found nothing; for telemetry only. */
  found: boolean;
}

/** Other agents ask about any repo, whatever repo the app's window has chosen. */
const ALL_REPOS = { allRepos: true };

/** Most PRs a search answer lists. */
const SEARCH_LIMIT = 25;

async function header(reader: PostPileReader): Promise<string[]> {
  const [report, viewer] = await Promise.all([reader.lastSyncReport(), reader.getViewer()]);
  const who = viewer.login ? `It works for @${viewer.login}; "you" below means them.` : 'It does not know its user yet.';
  return [freshness(report), who];
}

/** Every stored PR with this number, from the search index (topics hold every PR the app tracks). */
async function keysWithNumber(reader: PostPileReader, number: number): Promise<PrKey[]> {
  const result = await reader.search(`#${number}`, ALL_REPOS);
  const keys = new Set<PrKey>();
  for (const match of result.topics) {
    for (const key of match.prKeys) {
      if (parsePrKey(key).number === number) {
        keys.add(key);
      }
    }
  }
  return [...keys].sort();
}

type Resolved = { ok: true; key: PrKey } | { ok: false; text: string };

async function resolvePr(reader: PostPileReader, input: string): Promise<Resolved> {
  const parsed = parsePrInput(input);
  if (!parsed) {
    return { ok: false, text: `Could not read "${input}" as a PR. Pass owner/repo#123, a PR URL, or #123.` };
  }
  if (parsed.kind === 'key') {
    return { ok: true, key: parsed.key };
  }
  const keys = await keysWithNumber(reader, parsed.number);
  if (keys.length === 1) {
    return { ok: true, key: keys[0] as PrKey };
  }
  if (keys.length === 0) {
    return { ok: false, text: `PostPile tracks no PR #${parsed.number}. It only knows PRs that reached the user's GitHub inbox, their own PRs and their review requests.` };
  }
  return { ok: false, text: `Several PRs are #${parsed.number}; pass one of these: ${keys.join(', ')}` };
}

function tilesWith(topic: TopicDetail, key: PrKey): TileView[] {
  return topic.tiles.filter((view) => view.tile.members.some((member) => member.prKey === key));
}

/** "Stack: layer 2 of 3 (bottom first): acme/app#1851, acme/app#1902 (this PR), acme/app#1911". */
function stackLines(tiles: TileView[], key: PrKey): string[] {
  const lines: string[] = [];
  for (const view of tiles) {
    for (const stack of view.tile.stacks) {
      const index = stack.prKeys.indexOf(key);
      if (index < 0) {
        continue;
      }
      const layers = stack.prKeys.map((k) => (k === key ? `${k} (this PR)` : k)).join(', ');
      lines.push(`Stack: layer ${index + 1} of ${stack.prKeys.length} (bottom first): ${layers}`);
    }
  }
  return [...new Set(lines)];
}

function prLines(detail: PrDetail, tiles: TileView[]): string[] {
  const { pr } = detail;
  const lines = [
    `${pr.key}  ${pr.title}`,
    `${stateWord(pr.state, pr.isDraft)}, by ${pr.author}, +${pr.additions} -${pr.deletions}, updated ${day(pr.updatedAt)}`,
    pr.url,
  ];
  for (const view of tiles) {
    lines.push(turnText(view.turn));
    const unread = view.state.unreadBecause.filter((reason) => reason.prKey === pr.key);
    for (const reason of unread) {
      lines.push(`Unread for you: ${withActor(reason.actor, reason.summary)} (${day(reason.at)})`);
    }
    if (view.state.kind === 'snoozed') {
      lines.push('The user snoozed this.');
    }
  }
  lines.push(...stackLines(tiles, pr.key));
  if (detail.viewerApproval) {
    lines.push(`You approved it on ${day(detail.viewerApproval.at)}.`);
  } else if (detail.agentApprovers.length > 0) {
    lines.push(`Approved by agents only: ${detail.agentApprovers.join(', ')}.`);
  }
  if (detail.whatsNew) {
    lines.push(`New since you looked: ${whatsNewText(detail.whatsNew)}`);
  }
  if (detail.glance) {
    lines.push('', ...glanceLines(detail.glance, detail.glanceStale));
  } else {
    lines.push('', `No agent glance yet (${detail.glanceState}).`);
  }
  const facts = formatFacts(detail.facts);
  if (facts.length > 0) {
    lines.push('', ...facts);
  }
  // The detail pane's list: push bursts collapsed, bot and CI noise folded into one line.
  const { activity } = detail;
  const shown = [...activity.fresh, ...activity.earlier].slice(0, activity.cap);
  if (shown.length > 0) {
    lines.push('', 'Activity (newest first; * = new since you looked):');
    for (const line of shown) {
      lines.push(`  ${line.isNew ? '*' : ' '} ${day(line.at)}  ${withActor(line.actor, line.summary)}`);
    }
  }
  const noise = activity.noise.length + activity.freshNoise.length;
  if (noise > 0) {
    lines.push(`  Folded: ${[activity.freshNoiseLabel, activity.noiseLabel].filter((label) => label !== '').join('; ')}`);
  }
  return lines;
}

/** The topic's name, dossier and every tile with its PRs. `thisPr` is marked when given. */
function topicLines(detail: TopicDetail, thisPr: PrKey | null): string[] {
  const { topic } = detail;
  const lines = [`Topic: ${topic.name} (id ${topic.id}, ${topic.status}), driver ${topic.driver ?? 'unknown'}, the user is ${topic.userRole}`];
  if (topic.summary) {
    lines.push(topic.summary);
  }
  if (detail.placement) {
    lines.push(`Why the user sees it: ${detail.placement.whyYou}${detail.placement.ownerTeam ? ` (owned by ${detail.placement.ownerTeam})` : ''}`);
  }
  if (detail.dossier) {
    lines.push('', ...formatDossier(detail.dossier));
  }
  lines.push('', 'PRs in this topic, by tile:');
  for (const view of detail.tiles) {
    lines.push(`  ${tileLine(view)}`);
    for (const pr of view.prs) {
      lines.push(`    ${prSummaryLine(pr)}${pr.key === thisPr ? '  <- this PR' : ''}`);
    }
  }
  return lines;
}

export async function prContext(reader: PostPileReader, input: string): Promise<ToolAnswer> {
  const resolved = await resolvePr(reader, input);
  if (!resolved.ok) {
    return { text: resolved.text, found: false };
  }
  const detail = await reader.getPr(resolved.key);
  if (!detail) {
    return { text: `PostPile tracks no PR ${resolved.key}. It only knows PRs that reached the user's GitHub inbox, their own PRs and their review requests.`, found: false };
  }
  const topic = detail.topicId ? await reader.getTopic(detail.topicId) : null;
  const tiles = topic ? tilesWith(topic, detail.pr.key) : [];
  const data = prLines(detail, tiles);
  if (topic) {
    data.push('', ...topicLines(topic, detail.pr.key));
  } else {
    data.push('', 'Not in a topic yet.');
  }
  return { text: answer(await header(reader), data), found: true };
}

type TopicMatch = { ok: true; item: TopicListItem } | { ok: false; text: string };

function findTopic(items: TopicListItem[], input: string): TopicMatch {
  const text = input.trim().toLowerCase();
  const byId = items.find((item) => item.topic.id.toLowerCase() === text);
  if (byId) {
    return { ok: true, item: byId };
  }
  const byName = items.filter((item) => item.topic.name.toLowerCase().includes(text));
  if (byName.length === 1) {
    return { ok: true, item: byName[0] as TopicListItem };
  }
  if (byName.length === 0) {
    return { ok: false, text: `No topic matches "${input}". Use search_prs to find a PR first, or pass a topic id from whats_on_me.` };
  }
  const names = byName.slice(0, 10).map((item) => `${item.topic.id} (${item.topic.name})`);
  return { ok: false, text: `Several topics match "${input}"; pass one id: ${names.join(', ')}` };
}

export async function topicOverview(reader: PostPileReader, input: string): Promise<ToolAnswer> {
  const match = findTopic(await reader.listTopics(ALL_REPOS), input);
  if (!match.ok) {
    return { text: match.text, found: false };
  }
  const detail = await reader.getTopic(match.item.topic.id);
  if (!detail) {
    return { text: `Topic ${match.item.topic.id} is gone.`, found: false };
  }
  return { text: answer(await header(reader), topicLines(detail, null)), found: true };
}

export async function searchPrs(reader: PostPileReader, query: string): Promise<ToolAnswer> {
  const result = await reader.search(query, ALL_REPOS);
  const lines: string[] = [];
  let total = 0;
  for (const match of result.topics) {
    const detail = await reader.getTopic(match.topicId);
    if (!detail) {
      continue;
    }
    for (const view of detail.tiles) {
      for (const pr of view.prs) {
        if (!match.prKeys.includes(pr.key)) {
          continue;
        }
        total += 1;
        if (total <= SEARCH_LIMIT) {
          lines.push(`${prSummaryLine(pr)}  · topic ${detail.topic.name} (${detail.topic.id}) · ${turnText(view.turn)}`);
        }
      }
    }
  }
  if (total === 0) {
    return { text: `No PR matches "${query}". Every word must appear in the title, #number, author, repo, branch or topic name.`, found: false };
  }
  if (total > SEARCH_LIMIT) {
    lines.push(`… and ${total - SEARCH_LIMIT} more; narrow the query.`);
  }
  return { text: answer(await header(reader), lines), found: true };
}

function isLive(view: TileView): boolean {
  return view.state.kind !== 'done' && view.state.kind !== 'snoozed';
}

export async function whatsOnMe(reader: PostPileReader): Promise<ToolAnswer> {
  const items = (await reader.listTopics(ALL_REPOS)).filter((item) => item.group === 'needs_you');
  const yourMove: string[] = [];
  const unread: string[] = [];
  for (const item of items) {
    const detail = await reader.getTopic(item.topic.id);
    if (!detail) {
      continue;
    }
    for (const view of detail.tiles.filter(isLive)) {
      const keys = view.prs.map((pr) => pr.key).join(', ');
      const line = `- ${view.tile.title} (${keys}) · topic ${detail.topic.name} (${detail.topic.id})`;
      if (view.turn.kind === 'you') {
        yourMove.push(`${line}\n  ${view.turn.what}`);
      } else if (view.state.kind === 'unread') {
        const reason = view.state.unreadBecause[0];
        unread.push(`${line}\n  ${reason ? withActor(reason.actor, reason.summary) : 'unread'} · ${turnText(view.turn)}`);
      }
    }
  }
  if (yourMove.length === 0 && unread.length === 0) {
    return { text: [...(await header(reader)), '', 'Nothing waits on the user right now.'].join('\n'), found: false };
  }
  const data = [`Your move (${yourMove.length}):`, ...yourMove, '', `Unread, not your move (${unread.length}):`, ...unread];
  return { text: answer(await header(reader), data), found: true };
}
