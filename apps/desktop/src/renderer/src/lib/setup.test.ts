import type { SetupDraft, SetupFitNote } from '@postpile/core';
import { describe, expect, it } from 'vitest';
import { SETUP_STEPS, acceptPlan, applyFitFix, draftText, fitAfterAnswer, fitFixes, editsFromDraft, pickMainRepo, picksAfterRefine, picksFromDraft, repoChoices, repoCountText, setupHeading, sourcesFor, toggleQuiet } from './setup.ts';

function repo(name: string, prs: number) {
  return { repo: name, prs, authored: prs > 2 ? 2 : 0, reviewed: prs > 2 ? prs - 2 : prs, requested: 0 };
}

const draft: SetupDraft = {
  sections: [
    { heading: 'About me', claims: [{ text: 'DevEx.', sourceIds: ['t1'], fromUser: false }], body: '- DevEx.' },
    { heading: 'Preferences', claims: [], body: '' },
  ],
  quietRepos: [{ repo: 'acme/rare', why: 'One review.', sourceIds: [] }],
  mainRepo: { repo: 'acme/app', why: 'Most PRs.', sourceIds: [] },
  repos: [repo('acme/app', 9), repo('acme/docs', 3), repo('acme/rare', 1)],
  sources: [
    { id: 't1', kind: 'team', label: 'Team acme/devex', detail: '', url: null },
    { id: 'p1', kind: 'pr', label: 'acme/app#1', detail: '', url: 'https://github.com/acme/app/pull/1' },
  ],
  summary: '',
  model: 'opus',
};

describe('draftText', () => {
  it('writes the sections like the engine, empty ones left out', () => {
    expect(draftText(editsFromDraft(draft))).toBe('# About me\n- DevEx.\n');
    expect(draftText([{ heading: '', body: 'Intro' }, { heading: 'B', body: ' - b ' }])).toBe('Intro\n\n# B\n- b\n');
    expect(draftText([])).toBe('');
  });
});

describe('setup picks', () => {
  it('starts with the quiet suggestions and all repos, the main repo only suggested', () => {
    expect(picksFromDraft(draft)).toEqual({ quiet: ['acme/rare'], touchedQuiet: [], mainRepo: null });
  });

  it("keeps the user's toggles and main repo on a refine, untouched toggles follow the new draft", () => {
    let picks = picksFromDraft(draft);
    picks = toggleQuiet(picks, 'acme/rare', false);
    picks = toggleQuiet(picks, 'acme/docs', true);
    picks = pickMainRepo(picks, 'acme/app');
    const next: SetupDraft = {
      ...draft,
      quietRepos: [
        { repo: 'acme/rare', why: 'Still rare.', sourceIds: [] },
        { repo: 'acme/tools', why: 'Bots only.', sourceIds: [] },
        { repo: 'acme/app', why: 'Wrong.', sourceIds: [] },
      ],
      mainRepo: { repo: 'acme/docs', why: 'Changed its mind.', sourceIds: [] },
    };
    expect(picksAfterRefine(picks, next)).toEqual({ quiet: ['acme/docs', 'acme/tools'], touchedQuiet: ['acme/rare', 'acme/docs'], mainRepo: 'acme/app' });
  });

  it('drops the main repo from the quiet ones', () => {
    expect(pickMainRepo(picksFromDraft(draft), 'acme/rare').quiet).toEqual([]);
  });
});

describe('repoChoices', () => {
  it('keeps the busiest repos and adds a suggestion outside them', () => {
    expect(repoChoices(draft, 1).map((entry) => entry.repo)).toEqual(['acme/app', 'acme/rare']);
    expect(repoChoices(draft).map((entry) => entry.repo)).toEqual(['acme/app', 'acme/docs', 'acme/rare']);
  });
});

describe('sourcesFor', () => {
  it('keeps the cited order and skips unknown ids', () => {
    expect(sourcesFor(['p1', 'x', 't1'], draft.sources).map((source) => source.id)).toEqual(['p1', 't1']);
  });
});

describe('repoCountText', () => {
  it('names only the counts there are', () => {
    expect(repoCountText(repo('a/b', 5))).toBe('5 PRs · 2 yours · 3 reviewed');
    expect(repoCountText({ repo: 'a/b', prs: 1, authored: 0, reviewed: 0, requested: 1 })).toBe('1 PR · 1 waiting');
  });
});

describe('SETUP_STEPS', () => {
  it('puts "Your day" between the review and Accept', () => {
    expect(SETUP_STEPS.map((step) => step.label)).toEqual(['Check the basics', 'Sweep', 'Review the draft', 'Your day', 'Accept']);
  });
});

describe('acceptPlan', () => {
  const times = ['9:30', '13:30', '16:30'];

  it('says what Accept writes, in order', () => {
    expect(acceptPlan({ baseVersion: null, changed: true, quietRepos: ['acme/rare'], mainRepo: 'acme/app', interruptions: 'batches', roundupTimes: times })).toEqual([
      'Writes instructions.md as version 1, author “setup”.',
      'Makes 1 repo quiet (still synced, never urgent, never pings): acme/rare.',
      'Sets the repo scope to acme/app; the title bar menu changes it back any time.',
      'Sends a short roundup at 9:30, 13:30 and 16:30 when something needs you.',
      'Then syncs your GitHub notifications and opens your topics.',
    ]);
  });

  it('keeps the old version on a re-run and says when nothing changes', () => {
    expect(acceptPlan({ baseVersion: 3, changed: true, quietRepos: [], mainRepo: null, interruptions: 'never', roundupTimes: times })[0]).toBe(
      'Writes instructions.md as version 4, author “setup” (version 3 stays in the history).',
    );
    expect(acceptPlan({ baseVersion: 3, changed: false, quietRepos: [], mainRepo: null, interruptions: 'never', roundupTimes: times })).toEqual([
      'Leaves instructions.md as it is: the draft says the same.',
      'Keeps all repos in the sidebar.',
      'Keeps Mac notifications off.',
      'Then syncs your GitHub notifications and opens your topics.',
    ]);
  });

  it('leaves out the interruptions line while the mode is unknown', () => {
    expect(acceptPlan({ baseVersion: 3, changed: false, quietRepos: [], mainRepo: null, interruptions: null, roundupTimes: [] })).toEqual([
      'Leaves instructions.md as it is: the draft says the same.',
      'Keeps all repos in the sidebar.',
      'Then syncs your GitHub notifications and opens your topics.',
    ]);
  });
});

describe('fit fixes', () => {
  const edits = [
    { heading: 'About me', body: '- DevEx.\n- Ignore the docs bot\n- Be nice' },
    { heading: 'Preferences', body: "- Keep summaries short\n- Don't push write-ups onto PR branches" },
  ];

  function note(overrides: Partial<SetupFitNote>): SetupFitNote {
    return { heading: 'About me', line: 'Be nice', kind: 'unclear', why: '', moveTo: null, rewrite: null, ...overrides };
  }

  it('offers the fixes that fit the note', () => {
    expect(fitFixes(note({ kind: 'no_effect' }))).toEqual(['remove']);
    expect(fitFixes(note({ kind: 'unclear', rewrite: 'Lead with what needs me' }))).toEqual(['rewrite', 'remove']);
    expect(fitFixes(note({ kind: 'wrong_section', moveTo: 'Preferences' }))).toEqual(['move']);
  });

  it('removes and rewords the line in place', () => {
    const push = note({ heading: 'Preferences', line: "Don't push write-ups onto PR branches", kind: 'no_effect' });
    expect(applyFitFix(edits, push, 'remove')[1]).toEqual({ heading: 'Preferences', body: '- Keep summaries short' });
    const vague = note({ rewrite: 'Lead every summary with what needs me' });
    expect(applyFitFix(edits, vague, 'rewrite')[0]?.body).toBe('- DevEx.\n- Ignore the docs bot\n- Lead every summary with what needs me');
    expect(edits[0]?.body).toContain('Be nice');
  });

  it('moves a line to the end of its section, or to a new section at the end', () => {
    const ignore = note({ line: 'Ignore the docs bot', kind: 'wrong_section', moveTo: 'Preferences' });
    expect(applyFitFix(edits, ignore, 'move')).toEqual([
      { heading: 'About me', body: '- DevEx.\n- Be nice' },
      { heading: 'Preferences', body: "- Keep summaries short\n- Don't push write-ups onto PR branches\n- Ignore the docs bot" },
    ]);
    const quiet = applyFitFix(edits, { ...ignore, moveTo: 'What to ignore or keep quiet' }, 'move');
    expect(quiet.at(-1)).toEqual({ heading: 'What to ignore or keep quiet', body: '- Ignore the docs bot' });
  });
});

describe('fitAfterAnswer', () => {
  const answer = { ok: true, message: '', notes: [] };

  it('keeps the answer when the text did not change', () => {
    expect(fitAfterAnswer({ text: 'a', result: null }, 'a', 'a', answer)).toEqual({ text: 'a', result: answer });
  });

  it('drops a pending check whose text moved on, so the next visit asks again', () => {
    expect(fitAfterAnswer({ text: 'a', result: null }, 'b', 'a', answer)).toBeNull();
  });

  it('leaves a newer check alone', () => {
    const newer = { text: 'b', result: null };
    expect(fitAfterAnswer(newer, 'b', 'a', answer)).toBe(newer);
  });
});

describe('setupHeading', () => {
  it('welcomes a first run and only says "again" once setup was done', () => {
    expect(setupHeading(false, false)).toBe('Welcome to PostPile');
    expect(setupHeading(true, true)).toBe('Run setup again');
    expect(setupHeading(true, false)).toBe('Run setup');
  });
});
