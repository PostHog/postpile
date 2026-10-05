import type { InterruptionsMode, InterruptionsView } from '@postpile/core';

/**
 * The mode shown before GET /api/interruptions answers: core's
 * DEFAULT_INTERRUPTIONS. The renderer imports types only, so this small copy
 * lives here; keep the two in step.
 */
export const FALLBACK_INTERRUPTIONS: InterruptionsMode = 'never';

/** The three modes in the order the setup cards and the sidebar menu list them. */
export const INTERRUPTIONS_ORDER: InterruptionsMode[] = ['never', 'batches', 'asap'];

const TITLES: Record<InterruptionsMode, string> = {
  never: 'Never',
  batches: 'In batches',
  asap: 'As soon as it matters',
};

/** The quiet value on the right of the sidebar's "Interruptions" row. */
const ROW_VALUES: Record<InterruptionsMode, string> = {
  never: 'never',
  batches: 'in batches',
  asap: 'asap',
};

export function interruptionsTitle(mode: InterruptionsMode): string {
  return TITLES[mode];
}

export function interruptionsRowValue(mode: InterruptionsMode): string {
  return ROW_VALUES[mode];
}

/** "9:30, 13:30 and 16:30"; empty before the times have loaded. */
export function roundupTimesText(times: string[]): string {
  if (times.length <= 1) {
    return times.join('');
  }
  return `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}`;
}

/** "At 9:30, 13:30 and 16:30, only when something needs you." */
function roundupLine(times: string[]): string {
  const text = roundupTimesText(times);
  return text === '' ? 'Only when something needs you.' : `At ${text}, only when something needs you.`;
}

export interface InterruptionsCard {
  title: string;
  tagline: string;
  lines: string[];
}

/** What one card of the setup step "Your day" says. */
export function interruptionsCard(mode: InterruptionsMode, times: string[]): InterruptionsCard {
  if (mode === 'batches') {
    return {
      title: TITLES.batches,
      tagline: 'A short roundup, three times a day.',
      lines: [roundupLine(times), 'Stay focused in between, without wondering what you missed.', 'One note per roundup, never a stream.'],
    };
  }
  if (mode === 'asap') {
    return {
      title: TITLES.asap,
      tagline: 'Tap me for the crucial things.',
      lines: ['Hear right away when someone is waiting on you.', 'Only people asking you or your team. Never bots, CI or FYIs.', 'The agent holds back what can wait.'],
    };
  }
  return {
    title: TITLES.never,
    tagline: 'I’ll come to PostPile.',
    lines: ['Nothing pops up while you work.', 'Get to inbox zero once, then check in when it suits you.', 'No Dock badge, no sounds. Your list waits for you.'],
  };
}

/** The one-line hint under a mode in the sidebar menu. */
export function interruptionsMenuHint(mode: InterruptionsMode, times: string[]): string {
  if (mode === 'batches') {
    const text = roundupTimesText(times);
    return text === '' ? 'A short roundup three times a day, only when something needs you.' : `A short roundup at ${text}, only when something needs you.`;
  }
  if (mode === 'asap') {
    return 'Right away when a person asks you or your team for something that can’t wait.';
  }
  return 'I’ll come to PostPile. Nothing pops up, no Dock badge.';
}

/** Setup's Accept list: what the pick does. */
export function interruptionsAcceptLine(mode: InterruptionsMode, times: string[]): string {
  if (mode === 'batches') {
    const text = roundupTimesText(times);
    return text === '' ? 'Sends a short roundup three times a day when something needs you.' : `Sends a short roundup at ${text} when something needs you.`;
  }
  if (mode === 'asap') {
    return 'Pings you as soon as something crucial needs you.';
  }
  return 'Keeps Mac notifications off.';
}

/** Only a mode that shows notifications makes macOS ask for permission. */
export function asksNotificationPermission(mode: InterruptionsMode): boolean {
  return mode !== 'never';
}

/**
 * The one-time prompt for installs that never chose (`chosen` false): only
 * once the view has loaded, and never on top of setup or the inbox cleanup
 * start dialog (`blocked`).
 */
export function showsInterruptionsPrompt(view: InterruptionsView | undefined, blocked: boolean): boolean {
  if (view === undefined || blocked) {
    return false;
  }
  return !view.chosen;
}

/**
 * The quiet lines next to the prompt's Save. Closing the prompt also stores
 * the current mode, so the first line says what closing keeps; a second line
 * with the macOS note only for a pick that notifies.
 */
export function interruptionsPromptHint(stored: InterruptionsMode, pick: InterruptionsMode): string[] {
  const lines = [`You can switch any time from Interruptions at the bottom of the sidebar. Closing this keeps ${TITLES[stored]}.`];
  if (asksNotificationPermission(pick)) {
    lines.push('macOS may ask for permission once.');
  }
  return lines;
}
