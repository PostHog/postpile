import { describe, expect, it } from 'vitest';
import { composeKey, PaneDrafts } from './pane-drafts.ts';

describe('PaneDrafts', () => {
  it('keeps a draft per PR and target, never shared between PRs', () => {
    const drafts = new PaneDrafts();
    drafts.setText('acme/app#1', 'reply:c1', 'For alice on #1');
    drafts.setText('acme/app#2', 'ask', 'For bob on #2');

    expect(drafts.text('acme/app#1', 'reply:c1')).toBe('For alice on #1');
    expect(drafts.text('acme/app#2', 'reply:c1')).toBe('');
    expect(drafts.text('acme/app#1', 'ask')).toBe('');
    expect(drafts.text('acme/app#2', 'ask')).toBe('For bob on #2');
  });

  it('drops a draft set to empty, and keeps agent drafts apart', () => {
    const drafts = new PaneDrafts();
    drafts.setText('acme/app#1', 'approve', 'LGTM');
    drafts.setAgentText('acme/app#1', 'approve', 'LGTM');
    drafts.setText('acme/app#1', 'approve', '');

    expect(drafts.text('acme/app#1', 'approve')).toBe('');
    expect(drafts.agentText('acme/app#1', 'approve')).toBe('LGTM');
    expect(drafts.agentText('acme/app#2', 'approve')).toBeNull();
    drafts.setAgentText('acme/app#1', 'approve', null);
    expect(drafts.agentText('acme/app#1', 'approve')).toBeNull();
  });

  it('remembers the open composer per PR', () => {
    const drafts = new PaneDrafts();
    drafts.setOpenTarget('acme/app#1', { kind: 'reply', commentId: 'c1' });

    expect(drafts.openTarget('acme/app#1')).toEqual({ kind: 'reply', commentId: 'c1' });
    expect(drafts.openTarget('acme/app#2')).toBeNull();
    drafts.setOpenTarget('acme/app#1', null);
    expect(drafts.openTarget('acme/app#1')).toBeNull();
  });

  it('keys a reply by its comment', () => {
    expect(composeKey({ kind: 'reply', commentId: 'c1' })).toBe('reply:c1');
    expect(composeKey({ kind: 'approve' })).toBe('approve');
  });
});
