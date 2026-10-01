// report.md: the simulate-start report for a human. Numbers per round, then
// the arms side by side after the last round.
import type { SnapshotDossier, SnapshotTile } from '@postpile/engine';
import type { ArmRound, CallSummary, SimulationReport, TopicSideBySide } from './report.ts';
import type { ArmName } from './simulate-args.ts';

/** One line, safe inside a table cell. */
function cell(text: string): string {
  return text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

function money(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function minutes(ms: number): string {
  return `${(ms / 60_000).toFixed(1)} min`;
}

function byKind(calls: CallSummary): string {
  const kinds = Object.entries(calls.byKind).sort(([a], [b]) => a.localeCompare(b));
  return kinds.length === 0 ? 'none' : kinds.map(([kind, count]) => `${kind} ${count}`).join(', ');
}

function multiPr(round: ArmRound): string {
  return `${round.multiPr.stack ?? 0} stacks, ${round.multiPr.set ?? 0} sets`;
}

function tileLine(tile: SnapshotTile): string {
  return tile.members.length === 1 ? tile.members[0]! : `${tile.kind} (${tile.members.length}): ${tile.members.join(', ')}`;
}

function header(report: SimulationReport): string[] {
  const { meta } = report;
  const [leader, ...followers] = meta.arms;
  const planned = meta.plannedPrs;
  return [
    '# simulate-start report',
    '',
    `Source: \`${meta.from}\`. Now: ${meta.now}. Window: last ${meta.days} days. Round size: ${meta.roundSize} pinged PRs.`,
    `Arms: ${meta.arms.join(', ')}. ${leader} assigns topics${followers.length > 0 ? `; the others (${followers.join(', ')}) get its topics each round` : ''}.`,
    meta.dryRun ? 'Dry run: no agent calls.' : '',
    `Planned: ${meta.plannedRounds} rounds, ${planned.pinged} pinged PRs, ${planned.found} found, ${planned.pulledIn} stack layers. Ran: ${report.rounds.length} rounds.`,
    '',
  ];
}

function totals(report: SimulationReport): string[] {
  const lines = ['## Totals', '', '| arm | calls | failed | cost | agent time | by kind |', '| --- | --- | --- | --- | --- | --- |'];
  for (const arm of report.meta.arms) {
    const calls = report.totals[arm];
    if (calls) {
      lines.push(`| ${arm} | ${calls.calls} | ${calls.failed} | ${money(calls.costUsd)} | ${minutes(calls.durationMs)} | ${byKind(calls)} |`);
    }
  }
  return [...lines, ''];
}

function rounds(report: SimulationReport): string[] {
  const lines: string[] = [];
  for (const round of report.rounds) {
    lines.push(`## Round ${round.index}`, '', `Starts ${round.startAt}. In: ${round.prs.pinged} pinged, ${round.prs.found} found, ${round.prs.pulledIn} stack layers.`, '');
    lines.push('| arm | calls | cost | agent time | topics | tiles | multi-PR | tiles kept / new / gone | PRs moved |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    const arms = Object.entries(round.arms) as [ArmName, ArmRound][];
    for (const [arm, data] of arms) {
      const churn = data.churn;
      lines.push(
        `| ${arm} | ${data.calls.calls} | ${money(data.calls.costUsd)} | ${minutes(data.calls.durationMs)} | ${data.topics} | ${data.tiles} | ${multiPr(data)} | ${churn.kept} / ${churn.added} / ${churn.gone} | ${churn.moved.length} |`,
      );
    }
    lines.push('');
    for (const [arm, data] of arms) {
      lines.push(`- ${arm} calls: ${byKind(data.calls)}`);
      for (const move of data.churn.moved) {
        const why = move.reasons.length > 0 ? ` (${move.reasons.map(cell).join('; ')})` : '';
        lines.push(`  - ${arm}: ${move.prKey} moved ${move.from} -> ${move.to}${why}`);
      }
    }
    lines.push('');
  }
  return lines;
}

function glances(report: SimulationReport): string[] {
  const { glances: agreement, meta } = report;
  const lines = [
    '## Glances across arms',
    '',
    `${agreement.compared} PRs have a glance in every arm. Verdict agrees on ${agreement.verdictSame}, risk level (first word of risk) on ${agreement.riskSame}.`,
    '',
  ];
  if (agreement.differences.length === 0) {
    return lines;
  }
  lines.push(`| PR | ${meta.arms.join(' | ')} |`, `| --- | ${meta.arms.map(() => '---').join(' | ')} |`);
  for (const difference of agreement.differences) {
    const views = meta.arms.map((arm) => {
      const view = difference.byArm[arm];
      return view ? `${view.verdict} / ${cell(view.riskLevel)}` : '-';
    });
    lines.push(`| ${difference.prKey} | ${views.join(' | ')} |`);
  }
  return [...lines, ''];
}

function topic(entry: TopicSideBySide, arms: ArmName[]): string[] {
  const value = (arm: ArmName, pick: (dossier: SnapshotDossier) => string): string => {
    const dossier = entry.byArm[arm]?.dossier;
    return dossier ? cell(pick(dossier)) : '-';
  };
  const lines = [`### ${cell(entry.name)} (\`${entry.topicId}\`)`, ''];
  // Unsorted, and topics no arm wrote a dossier for yet, have nothing to put side by side.
  if (arms.some((arm) => entry.byArm[arm]?.dossier)) {
    lines.push(
      `| | ${arms.join(' | ')} |`,
      `| --- | ${arms.map(() => '---').join(' | ')} |`,
      `| status | ${arms.map((arm) => value(arm, (d) => d.status)).join(' | ')} |`,
      `| note | ${arms.map((arm) => value(arm, (d) => d.statusNote)).join(' | ')} |`,
      `| goal | ${arms.map((arm) => value(arm, (d) => d.goal)).join(' | ')} |`,
      '',
    );
  }
  for (const arm of arms) {
    const tiles = entry.byArm[arm]?.tiles;
    lines.push(`- ${arm} tiles: ${tiles ? tiles.map(tileLine).join(' · ') || 'none' : 'topic not shown'}`);
  }
  return [...lines, ''];
}

export function formatReportMarkdown(report: SimulationReport): string {
  const lines = [...header(report), ...totals(report), ...rounds(report), ...glances(report), '## Topics side by side', ''];
  for (const entry of report.topics) {
    lines.push(...topic(entry, report.meta.arms));
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
