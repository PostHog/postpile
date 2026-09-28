// Every query key in one place, so actions can invalidate what they change.
export const queryKeys = {
  config: ['config'] as const,
  githubWrites: ['github-writes'] as const,
  live: ['live'] as const,
  topics: ['topics'] as const,
  viewer: ['viewer'] as const,
  topic: (topicId: string) => ['topic', topicId] as const,
  search: (query: string) => ['search', query] as const,
  pr: (prKey: string) => ['pr', prKey] as const,
  chat: (tileId: string) => ['chat', tileId] as const,
  proposals: ['proposals'] as const,
  instructions: ['instructions'] as const,
  instructionsChat: ['instructions-chat'] as const,
  workContext: ['work-context'] as const,
  debugNotifications: (limit: number) => ['debug-notifications', limit] as const,
  memorySources: (targetKey: string) => ['memory-sources', targetKey] as const,
};
