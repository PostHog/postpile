// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RECENT_DOT_MS } from '../lib/recent-dots.ts';
import { UnreadDot } from './pills.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Two rows in a row, like a tile changing group: the old one unmounts while the new one mounts. */
function Rows(props: { moved: boolean; dotKey: string }) {
  return props.moved ? (
    <div key="dealt">
      <UnreadDot shown={false} dotKey={props.dotKey} />
    </div>
  ) : (
    <div key="unread">
      <UnreadDot shown dotKey={props.dotKey} />
    </div>
  );
}

describe('UnreadDot', () => {
  it('ripples out when a shown dot hides, and stays mounted', () => {
    const { container, rerender } = render(<UnreadDot shown dotKey="tile:acme/app#1" />);
    expect(screen.getByRole('img', { name: 'Unread' })).toBeTruthy();
    expect(screen.queryByTestId('unread-ripple')).toBeNull();

    rerender(<UnreadDot shown={false} dotKey="tile:acme/app#1" />);
    expect(screen.queryByRole('img', { name: 'Unread' })).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('unread-ripple')).toBeTruthy();
  });

  it('never ripples for a dot that mounts hidden', () => {
    const { rerender } = render(<UnreadDot shown={false} dotKey="tile:acme/app#2" />);
    rerender(<UnreadDot shown={false} dotKey="tile:acme/app#2" />);
    expect(screen.queryByTestId('unread-ripple')).toBeNull();
  });

  it('drops the ripple when the dot shows again', () => {
    const { rerender } = render(<UnreadDot shown dotKey="tile:acme/app#3" />);
    rerender(<UnreadDot shown={false} dotKey="tile:acme/app#3" />);
    rerender(<UnreadDot shown dotKey="tile:acme/app#3" />);
    expect(screen.queryByTestId('unread-ripple')).toBeNull();
  });

  it('ripples when its row remounts hidden right after the dot was shown', () => {
    const { rerender } = render(<Rows moved={false} dotKey="tile:acme/app#4" />);
    rerender(<Rows moved dotKey="tile:acme/app#4" />);
    expect(screen.getByTestId('unread-ripple')).toBeTruthy();
  });

  it('does not ripple a remount long after the dot was last shown', () => {
    vi.useFakeTimers();
    const { unmount } = render(<Rows moved={false} dotKey="tile:acme/app#5" />);
    unmount();
    vi.advanceTimersByTime(RECENT_DOT_MS + 1);
    render(<Rows moved dotKey="tile:acme/app#5" />);
    expect(screen.queryByTestId('unread-ripple')).toBeNull();
  });

  it('marks the countdown for the pie, and none without one', () => {
    const { container, rerender } = render(<UnreadDot shown dotKey="tile:acme/app#6" countdown="draining" />);
    const pie = () => container.querySelector('.unread-pie');
    expect(pie()?.getAttribute('data-countdown')).toBe('draining');
    rerender(<UnreadDot shown dotKey="tile:acme/app#6" countdown={null} />);
    expect(pie()?.hasAttribute('data-countdown')).toBe(false);
  });
});
