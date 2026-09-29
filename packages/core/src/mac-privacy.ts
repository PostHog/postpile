// Folders macOS guards with a privacy prompt (TCC): the first time an app
// lists or opens something inside, the user is asked whether PostPile may
// access "files in your Documents folder", "data from other apps" and so on.
// The work context sweep never follows a path into one of them.

/** The guarded folders for a home folder: the user folders, iCloud and cloud drives, other apps' containers, external volumes. */
export function macPrivacyFolders(home: string): string[] {
  const base = home.replace(/\/+$/, '');
  return [
    `${base}/Documents`,
    `${base}/Desktop`,
    `${base}/Downloads`,
    `${base}/Pictures`,
    `${base}/Movies`,
    `${base}/Music`,
    `${base}/Library/Mobile Documents`,
    `${base}/Library/CloudStorage`,
    `${base}/Library/Group Containers`,
    `${base}/Library/Containers`,
    '/Volumes',
  ];
}

/** The guarded folder `path` is in (or is), or null. Compares whole path parts, so ~/DocumentsOld is not inside ~/Documents. */
export function macPrivacyFolderOf(path: string, home: string): string | null {
  for (const folder of macPrivacyFolders(home)) {
    if (path === folder || path.startsWith(`${folder}/`)) {
      return folder;
    }
  }
  return null;
}
