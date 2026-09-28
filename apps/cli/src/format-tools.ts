import type { ToolStatus, ToolsView } from '@postpile/core';

function toolLines(name: string, status: ToolStatus<string>): string[] {
  const lines = [`${name}: ${status.state} · ${status.headline}`];
  if (status.detail !== '') {
    lines.push(`  ${status.detail}`);
  }
  if (status.retryAt !== null) {
    lines.push(`  tried again after ${status.retryAt}`);
  }
  for (const fix of status.fixes) {
    lines.push(fix.command === null ? `  fix: ${fix.label}` : `  fix: ${fix.label}: ${fix.command}`);
  }
  return lines;
}

/** `pnpm cli tools`: both tools, what works, and the exact commands for what does not. */
export function formatTools(view: ToolsView): string {
  const lines = [...toolLines('gh', view.gh), ...toolLines('claude', view.claude)];
  lines.push(view.canSync ? 'sync: on' : 'sync: off until gh works');
  lines.push(view.agentOn ? 'agent: on' : 'agent: off, rules only');
  return lines.join('\n');
}
