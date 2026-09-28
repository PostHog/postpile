import type { SetupChecksView, SetupDraft, SetupRepoPick, SetupSource, SetupSweepView } from '@postpile/core';

function checkLines(checks: SetupChecksView): string[] {
  return checks.checks.map((check) => {
    const fix = check.fix ? ` (fix: ${check.fix})` : '';
    return `  ${check.state.padEnd(7)} ${check.label}: ${check.detail}${fix}`;
  });
}

function pickLine(pick: SetupRepoPick): string {
  const cited = pick.sourceIds.length > 0 ? ` [${pick.sourceIds.join(', ')}]` : '';
  return `${pick.repo}: ${pick.why}${cited}`;
}

/** The draft as the file text it would write, each line with the source ids it cites. */
function draftLines(draft: SetupDraft): string[] {
  const lines: string[] = [];
  for (const section of draft.sections) {
    lines.push(`# ${section.heading}`);
    for (const claim of section.claims) {
      const cited = claim.fromUser ? ' [your words]' : claim.sourceIds.length > 0 ? ` [${claim.sourceIds.join(', ')}]` : ' [no source]';
      lines.push(`- ${claim.text}${cited}`);
    }
    lines.push('');
  }
  return lines;
}

function sourceLine(source: SetupSource): string {
  const detail = source.detail.replace(/\s+/g, ' ').trim();
  return `  ${source.id.padEnd(4)} ${source.label}${detail ? `: ${detail}` : ''}`;
}

/**
 * `setup-draft`: the checks, the sweep's progress lines and the draft with
 * its citations. Only the sources the draft cites are listed, then how many
 * others the sweep offered.
 */
export function formatSetupDraft(checks: SetupChecksView, sweep: SetupSweepView | null): string {
  const lines = ['Checks', ...checkLines(checks), ''];
  if (!sweep) {
    lines.push('No sweep ran.');
    return lines.join('\n');
  }
  lines.push('Sweep', ...sweep.lines.map((line) => `  ${line.state.padEnd(7)} ${line.text}`));
  if (sweep.error) {
    lines.push(`  error: ${sweep.error}`);
  }
  const draft = sweep.draft;
  if (!draft) {
    return lines.join('\n');
  }
  lines.push('', `Draft (${draft.model ?? 'blank template'}): ${draft.summary}`, '', ...draftLines(draft));
  lines.push(`Main repo suggestion: ${draft.mainRepo ? pickLine(draft.mainRepo) : 'none'}`);
  lines.push('Quiet repo suggestions:', ...(draft.quietRepos.length > 0 ? draft.quietRepos.map((pick) => `  ${pickLine(pick)}`) : ['  none']));
  const cited = new Set([
    ...draft.sections.flatMap((section) => section.claims.flatMap((claim) => claim.sourceIds)),
    ...draft.quietRepos.flatMap((pick) => pick.sourceIds),
    ...(draft.mainRepo?.sourceIds ?? []),
  ]);
  const citedSources = draft.sources.filter((source) => cited.has(source.id));
  lines.push('', `Cited sources (${citedSources.length} of ${draft.sources.length} offered)`, ...citedSources.map(sourceLine));
  return lines.join('\n');
}
