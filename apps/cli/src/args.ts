export type Command =
  | { name: 'sync' }
  | { name: 'topics' }
  | { name: 'topic'; topicId: string }
  | { name: 'pr'; prKey: string }
  | { name: 'help' };

export const usage = `usage: code-manager <command>

  sync                 fetch notifications, digest, derive tiles
  topics               list topics with unread counts
  topic <id>           show a topic and its tiles
  pr <owner/repo#n>    show one PR: glance and events

CODE_MANAGER_FAKE=1 runs on built-in sample data (no GitHub, no agent).`;

export function parseArgs(argv: string[]): Command {
  const [name, arg] = argv;
  if (name === 'sync' || name === 'topics') {
    return { name };
  }
  if (name === 'topic' && arg) {
    return { name, topicId: arg };
  }
  if (name === 'pr' && arg) {
    return { name, prKey: arg };
  }
  return { name: 'help' };
}
