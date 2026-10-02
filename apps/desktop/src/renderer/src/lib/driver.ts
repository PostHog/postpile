import type { DriverChoice, TopicDriverView } from '@postpile/core';

/** The header's driver button: "You drive", "lyra drives", "Your team drives", "Someone outside your team drives". */
export function driverLabel(view: Pick<TopicDriverView, 'kind' | 'login'>): string {
  if (view.kind === 'you') {
    return 'You drive';
  }
  if (view.kind === 'team') {
    return 'Your team drives';
  }
  if (view.kind === 'outside') {
    return 'Someone outside your team drives';
  }
  return view.login ? `${view.login} drives` : 'Who drives?';
}

/** A driver menu item's name. */
export function choiceLabel(choice: Pick<DriverChoice, 'kind' | 'login'>): string {
  if (choice.kind === 'you') {
    return 'You';
  }
  if (choice.kind === 'team') {
    return 'Your team';
  }
  if (choice.kind === 'outside') {
    return 'Someone outside your team';
  }
  return choice.login ?? '';
}

/** The small line under the team and outside items; people have none. */
export function choiceHelper(choice: Pick<DriverChoice, 'kind'>): string | null {
  if (choice.kind === 'team') {
    return 'Shared, no single driver';
  }
  return choice.kind === 'outside' ? 'No name needed' : null;
}
