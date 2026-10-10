import { describe, expect, it } from 'vitest';
import type { InboxCleanupView, InterruptionsView, SetupStatus, ToolsView } from '@postpile/core';
import {
  asksNotificationPermission,
  interruptionsAcceptLine,
  interruptionsCard,
  interruptionsLead,
  interruptionsLeadText,
  interruptionsMenuHint,
  interruptionsPromptHint,
  interruptionsPromptWaits,
  interruptionsRowValue,
  interruptionsTitle,
  INTERRUPTIONS_ORDER,
  roundupTimesText,
  showsInterruptionsPrompt,
} from './interruptions.ts';

const TIMES = ['9:30', '13:30', '16:30'];

describe('roundupTimesText', () => {
  it('lists the times with "and" before the last', () => {
    expect(roundupTimesText(TIMES)).toBe('9:30, 13:30 and 16:30');
    expect(roundupTimesText(['9:30', '16:30'])).toBe('9:30 and 16:30');
    expect(roundupTimesText(['9:30'])).toBe('9:30');
    expect(roundupTimesText([])).toBe('');
  });
});

describe('interruptions words', () => {
  it('lists Never first, the calm default', () => {
    expect(INTERRUPTIONS_ORDER).toEqual(['never', 'batches', 'asap']);
    expect(INTERRUPTIONS_ORDER.map(interruptionsTitle)).toEqual(['Never', 'In batches', 'As soon as it matters']);
    expect(INTERRUPTIONS_ORDER.map(interruptionsRowValue)).toEqual(['never', 'in batches', 'asap']);
  });

  it('builds the batches card from the server times', () => {
    expect(interruptionsCard('batches', TIMES)).toEqual({
      title: 'In batches',
      tagline: 'A short roundup, three times a day.',
      lines: ['At 9:30, 13:30 and 16:30, only when something needs you.', 'Stay focused in between, without wondering what you missed.', 'One note per roundup, never a stream.'],
    });
    expect(interruptionsCard('batches', []).lines[0]).toBe('Only when something needs you.');
  });

  it('promises no Dock badge for Never', () => {
    expect(interruptionsCard('never', TIMES).lines).toContain('No Dock badge, no sounds. Your list waits for you.');
    expect(interruptionsMenuHint('never', TIMES)).toBe('I’ll come to PostPile. Nothing pops up, no Dock badge.');
  });

  it('says only people reach you right away', () => {
    expect(interruptionsCard('asap', TIMES).tagline).toBe('Tap me for the crucial things.');
    expect(interruptionsMenuHint('asap', TIMES)).toBe('Right away when a person asks you or your team for something that can’t wait.');
  });

  it('names the roundup times in the menu', () => {
    expect(interruptionsMenuHint('batches', TIMES)).toBe('A short roundup at 9:30, 13:30 and 16:30, only when something needs you.');
  });

  it('says what Accept does with the pick', () => {
    expect(interruptionsAcceptLine('never', TIMES)).toBe('Keeps Mac notifications off.');
    expect(interruptionsAcceptLine('batches', TIMES)).toBe('Sends a short roundup at 9:30, 13:30 and 16:30 when something needs you.');
    expect(interruptionsAcceptLine('asap', TIMES)).toBe('Pings you as soon as something crucial needs you.');
  });

  it('expects the macOS permission prompt only for modes that notify', () => {
    expect(asksNotificationPermission('never')).toBe(false);
    expect(asksNotificationPermission('batches')).toBe(true);
    expect(asksNotificationPermission('asap')).toBe(true);
  });
});

describe('showsInterruptionsPrompt', () => {
  const neverChosen: InterruptionsView = { mode: 'never', chosen: false, roundupTimes: TIMES };

  it('asks an install that never chose', () => {
    expect(showsInterruptionsPrompt(neverChosen, false)).toBe(true);
  });

  it('stays away once a mode was picked, even Never', () => {
    expect(showsInterruptionsPrompt({ ...neverChosen, chosen: true }, false)).toBe(false);
    expect(showsInterruptionsPrompt({ ...neverChosen, mode: 'asap', chosen: true }, false)).toBe(false);
  });

  it('waits for the view and for setup or the start dialog to be out of the way', () => {
    expect(showsInterruptionsPrompt(undefined, false)).toBe(false);
    expect(showsInterruptionsPrompt(neverChosen, true)).toBe(false);
  });
});

describe('interruptionsPromptWaits', () => {
  const idle = { start: null, running: null } as InboxCleanupView;
  const working = { canSync: true } as ToolsView;

  it('goes ahead when nothing else is on screen', () => {
    expect(interruptionsPromptWaits(idle, working)).toBe(false);
  });

  it('waits for the views, the start dialog, a running cleanup and a usable gh', () => {
    expect(interruptionsPromptWaits(undefined, working)).toBe(true);
    expect(interruptionsPromptWaits(idle, undefined)).toBe(true);
    expect(interruptionsPromptWaits({ ...idle, start: { kind: 'weekend', since: '2026-10-03T09:00:00.000Z' } }, working)).toBe(true);
    expect(interruptionsPromptWaits({ ...idle, running: { done: 1, total: 5, merged: true } }, working)).toBe(true);
    expect(interruptionsPromptWaits(idle, { ...working, canSync: false })).toBe(true);
  });
});

describe('interruptionsLead', () => {
  const status: SetupStatus = { needed: false, flag: null, flaggedAt: null, hasInstructions: false };

  it('gives a new install that skipped setup the neutral lead', () => {
    const lead = interruptionsLead({ ...status, flag: 'skipped' });
    expect(lead).toBe('fresh');
    expect(interruptionsLeadText(lead)).not.toContain('Until now');
  });

  it('keeps the upgrade lead for everyone else, and while the status loads', () => {
    expect(interruptionsLead({ ...status, flag: 'skipped', hasInstructions: true })).toBe('upgrade');
    expect(interruptionsLead({ ...status, hasInstructions: true })).toBe('upgrade');
    expect(interruptionsLead(undefined)).toBe('upgrade');
    expect(interruptionsLeadText('upgrade')).toContain('Until now');
  });
});

describe('interruptionsPromptHint', () => {
  it('says where to switch and what closing keeps', () => {
    expect(interruptionsPromptHint('never', 'never')).toEqual(['You can switch any time from Interruptions at the bottom of the sidebar. Closing this keeps Never.']);
  });

  it('adds the macOS note for a pick that notifies', () => {
    expect(interruptionsPromptHint('never', 'batches')).toEqual([
      'You can switch any time from Interruptions at the bottom of the sidebar. Closing this keeps Never.',
      'macOS may ask for permission once.',
    ]);
  });
});
