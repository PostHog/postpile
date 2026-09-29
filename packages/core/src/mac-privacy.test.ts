import { describe, expect, it } from 'vitest';
import { macPrivacyFolderOf } from './mac-privacy.ts';

describe('macPrivacyFolderOf', () => {
  it('names the guarded folder a path is in, by whole path parts', () => {
    expect(macPrivacyFolderOf('/Users/alice/Documents/notes/CLAUDE.md', '/Users/alice')).toBe('/Users/alice/Documents');
    expect(macPrivacyFolderOf('/Users/alice/Library/Mobile Documents/x.md', '/Users/alice/')).toBe('/Users/alice/Library/Mobile Documents');
    expect(macPrivacyFolderOf('/Volumes/usb/CLAUDE.md', '/Users/alice')).toBe('/Volumes');
    expect(macPrivacyFolderOf('/Users/alice/Documents', '/Users/alice')).toBe('/Users/alice/Documents');
    expect(macPrivacyFolderOf('/Users/alice/DocumentsOld/x.md', '/Users/alice')).toBeNull();
    expect(macPrivacyFolderOf('/Users/alice/dotfiles/claude/CLAUDE.md', '/Users/alice')).toBeNull();
    expect(macPrivacyFolderOf('/Users/alice/Library/Application Support/PostPile', '/Users/alice')).toBeNull();
  });
});
