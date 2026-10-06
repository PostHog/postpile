// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UnreadDot } from './pills.tsx';

afterEach(cleanup);

describe('UnreadDot', () => {
  it('ripples out when a shown dot hides, and stays mounted', () => {
    const { container, rerender } = render(<UnreadDot shown />);
    expect(screen.getByRole('img', { name: 'Unread' })).toBeTruthy();
    expect(screen.queryByTestId('unread-ripple')).toBeNull();

    rerender(<UnreadDot shown={false} />);
    expect(screen.queryByRole('img', { name: 'Unread' })).toBeNull();
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByTestId('unread-ripple')).toBeTruthy();
  });

  it('never ripples for a dot that mounts hidden', () => {
    const { rerender } = render(<UnreadDot shown={false} />);
    rerender(<UnreadDot shown={false} />);
    expect(screen.queryByTestId('unread-ripple')).toBeNull();
  });

  it('drops the ripple when the dot shows again', () => {
    const { rerender } = render(<UnreadDot shown />);
    rerender(<UnreadDot shown={false} />);
    rerender(<UnreadDot shown />);
    expect(screen.queryByTestId('unread-ripple')).toBeNull();
  });

  it('marks the countdown for the pie, and none without one', () => {
    const { container, rerender } = render(<UnreadDot shown countdown="draining" />);
    const pie = () => container.querySelector('.unread-pie');
    expect(pie()?.getAttribute('data-countdown')).toBe('draining');
    rerender(<UnreadDot shown countdown={null} />);
    expect(pie()?.hasAttribute('data-countdown')).toBe(false);
  });
});
