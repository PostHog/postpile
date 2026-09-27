import type { MemorySource, PrEvent } from '@code-manager/core';
import type { MemoryRecheckInput } from '../service.ts';
import { renderDossier } from './dossier.ts';
import { clip, contextBlock, GITHUB_DATA_RULE, githubData, jsonOnly, prDetails, shortDetail, viewerLine } from './shared.ts';

function sourceLine(source: MemorySource): string {
  const who = source.who ? `@${source.who} ` : '';
  const excerpt = source.excerpt ? `: ${clip(source.excerpt, 400)}` : '';
  const missing = source.missing ? ' (no longer in the stored data)' : '';
  return `- ${source.at.slice(0, 10)} ${who}${source.title}${missing}${excerpt}`;
}

function eventLine(event: PrEvent): string {
  return `- ${event.at.slice(0, 16)} ${event.prKey} ${event.kind} by @${event.actor}: ${clip(event.summary, 300)}`;
}

/**
 * "Recheck": the user doubts one line of what the agent remembers. The agent
 * reads the line against its sources, the dossier and the newest GitHub
 * activity and says whether it holds, needs a fix, or should go. Sources the
 * user wrote (instructions, corrections) are not GitHub text, so they are
 * not fenced.
 */
export function memoryRecheckPrompt(input: MemoryRecheckInput): string {
  const topic = input.topic ? `in the topic "${input.topic.name}"` : 'outside any topic';
  const github = input.sources.filter((source) => source.who !== null).map(sourceLine);
  const own = input.sources.filter((source) => source.who === null).map(sourceLine);
  const prs = input.prs.map((pr) => prDetails(pr, input.viewer, shortDetail)).join('\n\n');
  const dossier = input.dossier ? githubData(renderDossier(input.dossier, new Map(input.prs.map((pr) => [pr.key, pr])))) : '(no dossier)';
  return `You keep a developer's memory of their code review work. ${viewerLine(input.viewer)}
They asked you to recheck one line you remember ${topic}. Check it against GitHub as it is now.
${GITHUB_DATA_RULE}
${contextBlock(input.context)}
The line (${input.recordedIn}):
${githubData(input.claim)}

Sources recorded for it on GitHub:
${github.length === 0 ? '(none recorded)' : githubData(github.join('\n'))}

Sources in the user's own words:
${own.length === 0 ? '(none)' : own.join('\n')}

The topic dossier it belongs to:
${dossier}

Pull requests involved, as they are now:
${prs || '(none)'}

Newest activity on them, newest first:
${input.events.length === 0 ? '(none)' : githubData(input.events.map(eventLine).join('\n'))}

Answer with one outcome:
- "holds": the line is still right. "text" repeats the line.
- "fix": the line is partly wrong or out of date. "text" is the corrected line, one sentence,
  same style and length as the original. Only claim what the data above shows.
- "drop": the line no longer holds or was never supported, and there is nothing true to say instead.
"why" is one or two plain sentences with the evidence (who said or did what, when, on which PR).
If the data is not enough to tell, say "holds" and explain what is missing in "why".
${jsonOnly('{"outcome": "holds" | "fix" | "drop", "text": "...", "why": "..."}')}`;
}
