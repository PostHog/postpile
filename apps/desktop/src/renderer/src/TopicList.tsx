import type { TopicListItem } from '@code-manager/core';
import { clickable, paneStyle } from './styles.ts';

export function TopicList(props: { topics: TopicListItem[]; openTopicId: string | null; onOpen: (id: string) => void }) {
  return (
    <div style={paneStyle}>
      {(['needs_you', 'quiet'] as const).map((group) => (
        <div key={group}>
          <h4>{group === 'needs_you' ? 'Needs you' : 'Quiet'}</h4>
          {props.topics
            .filter((item) => item.group === group)
            .map((item) => (
              <div
                key={item.topic.id}
                onClick={() => props.onOpen(item.topic.id)}
                style={{ ...clickable, fontWeight: item.topic.id === props.openTopicId ? 'bold' : 'normal' }}
              >
                {item.topic.name} ({item.unreadTiles})
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
