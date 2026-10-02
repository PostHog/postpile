import type { TopicListItem } from './views.ts';

export interface BadgeView {
  unreadTopics: number;
}

export function unreadTopicCount(topics: Pick<TopicListItem, 'unreadTiles'>[]): number {
  return topics.filter((topic) => topic.unreadTiles > 0).length;
}

export function tabTitle(unreadTopics: number): string {
  return unreadTopics > 0 ? `(${unreadTopics}) PostPile` : 'PostPile';
}
