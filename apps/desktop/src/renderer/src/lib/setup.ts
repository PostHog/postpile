import type { SetupCheckState, SetupDraft, SetupLineState, SetupRepoCount, SetupSectionEdit, SetupSource } from '@postpile/core';

export type SetupStepKey = 'checks' | 'sweep' | 'review' | 'accept';

/** The four screens in order, with the words the progress indicator shows. */
export const SETUP_STEPS: { key: SetupStepKey; label: string }[] = [
  { key: 'checks', label: 'Check the basics' },
  { key: 'sweep', label: 'Sweep' },
  { key: 'review', label: 'Review the draft' },
  { key: 'accept', label: 'Accept' },
];

export type ChipTone = 'good' | 'bad' | 'warn' | 'quiet' | 'busy';

/** Word and tone of a check's chip: never a symbol alone. */
export const CHECK_CHIPS: Record<SetupCheckState, { word: string; tone: ChipTone }> = {
  ok: { word: 'OK', tone: 'good' },
  fail: { word: 'Fix this', tone: 'bad' },
  warn: { word: 'Warning', tone: 'warn' },
  skipped: { word: 'Waiting', tone: 'quiet' },
};

/** Word and tone of a sweep line's chip. */
export const LINE_CHIPS: Record<SetupLineState, { word: string; tone: ChipTone }> = {
  running: { word: 'Working', tone: 'busy' },
  done: { word: 'Done', tone: 'good' },
  failed: { word: 'Failed', tone: 'bad' },
  skipped: { word: 'Skipped', tone: 'quiet' },
};

/**
 * The sections as the file text, the same format the engine writes
 * (core's formatInstructionsSections): "# heading", the body, a blank line
 * between sections, empty sections left out. The renderer imports types
 * only, so this small copy lives here; keep the two in step.
 */
export function draftText(sections: SetupSectionEdit[]): string {
  const parts = sections
    .map((section) => ({ heading: section.heading.trim(), body: section.body.trim() }))
    .filter((section) => section.body !== '')
    .map((section) => (section.heading === '' ? section.body : `# ${section.heading}\n${section.body}`));
  return parts.length === 0 ? '' : `${parts.join('\n\n')}\n`;
}

/** The draft's sections as the text boxes start. */
export function editsFromDraft(draft: SetupDraft): SetupSectionEdit[] {
  return draft.sections.map((section) => ({ heading: section.heading, body: section.body }));
}

/** Repos the quiet toggles and main repo radios offer: the busiest ones, plus any suggestion outside them. */
export function repoChoices(draft: SetupDraft, max = 8): SetupRepoCount[] {
  const shown = draft.repos.slice(0, max);
  const suggested = [...draft.quietRepos.map((pick) => pick.repo), ...(draft.mainRepo ? [draft.mainRepo.repo] : [])];
  const extra = draft.repos.filter((repo) => !shown.includes(repo) && suggested.includes(repo.repo));
  return [...shown, ...extra];
}

/** The sources behind a list of ids, in the order cited; unknown ids are skipped. */
export function sourcesFor(ids: string[], sources: SetupSource[]): SetupSource[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return ids.flatMap((id) => {
    const source = byId.get(id);
    return source ? [source] : [];
  });
}

/** "4 PRs · 2 yours · 1 waiting", for a repo row. */
export function repoCountText(repo: SetupRepoCount): string {
  const parts = [`${repo.prs} ${repo.prs === 1 ? 'PR' : 'PRs'}`];
  if (repo.authored > 0) {
    parts.push(`${repo.authored} yours`);
  }
  if (repo.reviewed > 0) {
    parts.push(`${repo.reviewed} reviewed`);
  }
  if (repo.requested > 0) {
    parts.push(`${repo.requested} waiting`);
  }
  return parts.join(' · ');
}

const SOURCE_KIND_WORDS: Record<SetupSource['kind'], string> = {
  team: 'Team',
  pr: 'PR',
  codeowners: 'CODEOWNERS',
  digest: 'Digest',
};

export function sourceKindWord(kind: SetupSource['kind']): string {
  return SOURCE_KIND_WORDS[kind];
}

export interface AcceptPlanInput {
  /** The instructions version the draft was reviewed against; null when there is none. */
  baseVersion: number | null;
  /** Whether the draft differs from the current file. */
  changed: boolean;
  quietRepos: string[];
  mainRepo: string | null;
}

/** What Accept will do, one line each, in the order it happens. */
export function acceptPlan(input: AcceptPlanInput): string[] {
  const next = (input.baseVersion ?? 0) + 1;
  const lines = [
    input.changed
      ? `Writes instructions.md as version ${next}, author “setup”${input.baseVersion === null ? '' : ` (version ${input.baseVersion} stays in the history)`}.`
      : 'Leaves instructions.md as it is: the draft says the same.',
  ];
  if (input.quietRepos.length > 0) {
    lines.push(`Makes ${input.quietRepos.length === 1 ? '1 repo' : `${input.quietRepos.length} repos`} quiet (still synced, never urgent, never pings): ${input.quietRepos.join(', ')}.`);
  }
  lines.push(input.mainRepo ? `Sets the repo scope to ${input.mainRepo}; the title bar menu changes it back any time.` : 'Keeps all repos in the sidebar.');
  lines.push('Then syncs your GitHub notifications and opens your topics.');
  return lines;
}
