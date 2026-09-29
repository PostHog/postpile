import { describe, expect, it } from 'vitest';
import type { WhatsNew, WhatsNewAnchorKind, WhatsNewLead } from '@postpile/core';
import { at } from '@postpile/core/fixtures';
import { newSinceAnchor, STRIP_TEXT_MAX, whatsNewText } from './whats-new.ts';

function news(anchor: WhatsNewAnchorKind, lead: Partial<WhatsNewLead>): WhatsNew {
  const fullLead: WhatsNewLead = { kind: 'push', eventKind: 'commits_pushed', actor: 'pim', count: 1, summary: 'pim pushed', ...lead };
  return { anchor: { kind: anchor, at: at(0) }, lead: fullLead, extraCount: 0, actor: fullLead.actor, newestAt: at(10) };
}

describe('whatsNewText', () => {
  it('counts pushes since the changes request', () => {
    expect(whatsNewText(news('changes_request', { kind: 'push', count: 6 }))).toBe('6 commits since your changes request');
    expect(whatsNewText(news('changes_request', { kind: 'push', count: 1 }))).toBe('pim pushed since your changes request');
  });

  it('says a push after an approval', () => {
    expect(whatsNewText(news('approval', { kind: 'push', count: 1, actor: 'rowan' }))).toBe('pushed after your approval');
    expect(whatsNewText(news('approval', { kind: 'push', count: 2, actor: 'rowan' }))).toBe('2 commits after your approval');
  });

  it('says a reply to your review or your comment', () => {
    expect(whatsNewText(news('review', { kind: 'reply', actor: 'lyra' }))).toBe('lyra replied to your review');
    expect(whatsNewText(news('changes_request', { kind: 'reply', actor: 'lyra' }))).toBe('lyra replied to your review');
    expect(whatsNewText(news('comment', { kind: 'reply', actor: 'lyra' }))).toBe('lyra replied to your comment');
    expect(whatsNewText(news('read', { kind: 'reply', actor: 'lyra' }))).toBe('lyra commented since you marked it read');
  });

  it('says verdicts by others since your own', () => {
    expect(whatsNewText(news('approval', { kind: 'changes_requested', actor: 'lyra' }))).toBe('lyra requested changes since you approved');
    expect(whatsNewText(news('push', { kind: 'approved', actor: 'ada' }))).toBe('ada approved since your push');
  });

  it('says asks, mentions and re-requests', () => {
    expect(whatsNewText(news('read', { kind: 'mention', actor: 'lyra' }))).toBe('lyra mentioned you since you marked it read');
    expect(whatsNewText(news('review', { kind: 'review_request', actor: 'pim' }))).toBe('pim re-requested your review');
    expect(whatsNewText(news('comment', { kind: 'review_request', actor: 'pim' }))).toBe('pim requested your review since your comment');
    expect(whatsNewText(news('review', { kind: 'question', actor: 'ada' }))).toBe('ada asked you since your review');
  });

  it('drops the anchor when the line would not fit', () => {
    const text = whatsNewText(news('read', { kind: 'team_mention', actor: 'maximiliana' }));
    expect(text).toBe('maximiliana mentioned your team');
    expect(text.length).toBeLessThanOrEqual(STRIP_TEXT_MAX);
  });

  it('uses the summary for other kinds', () => {
    expect(whatsNewText(news('review', { kind: 'other', summary: 'pim marked it ready' }))).toBe('pim marked it ready since your review');
  });
});

describe('newSinceAnchor', () => {
  it('names the anchor and when', () => {
    expect(newSinceAnchor(news('changes_request', {}), 'yesterday')).toBe('since your changes request yesterday');
    expect(newSinceAnchor(news('read', {}), null)).toBe('since you marked it read');
  });

  it('is plain on a first look', () => {
    expect(newSinceAnchor(null, 'yesterday')).toBeNull();
  });
});
