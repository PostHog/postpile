import { describe, expect, it, vi } from 'vitest';
import { PingShelf, SHELF_MAX_AGE_MS } from './ping-shelf.ts';

function notification() {
  return { close: vi.fn() };
}

describe('PingShelf', () => {
  it('closes the ping of a PR that is not unread anymore and keeps the others', () => {
    const shelf = new PingShelf();
    const read = notification();
    const unread = notification();
    shelf.add('acme/app#1', read, 0);
    shelf.add('acme/app#2', unread, 0);
    shelf.closeRead(['acme/app#2'], 1000);
    expect(read.close).toHaveBeenCalledOnce();
    expect(unread.close).not.toHaveBeenCalled();
    expect(shelf.size()).toBe(1);
  });

  it('closes each ping once', () => {
    const shelf = new PingShelf();
    const read = notification();
    shelf.add('acme/app#1', read, 0);
    shelf.closeRead([], 1000);
    shelf.closeRead([], 2000);
    expect(read.close).toHaveBeenCalledOnce();
  });

  it('drops references older than a day without closing them', () => {
    const shelf = new PingShelf();
    const old = notification();
    shelf.add('acme/app#1', old, 0);
    shelf.closeRead(['acme/app#1'], SHELF_MAX_AGE_MS);
    expect(old.close).not.toHaveBeenCalled();
    expect(shelf.size()).toBe(0);
  });
});
