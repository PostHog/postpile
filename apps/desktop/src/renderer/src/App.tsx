// Placeholder UI. It only proves data flows from the API into three panes;
// layout and styling are not decided yet.
import { useEffect, useState } from 'react';
import type { PrDetail, TopicDetail, TopicListItem } from '@code-manager/core';
import * as api from './api.ts';

const paneStyle = { overflow: 'auto', padding: 8, borderRight: '1px solid #ccc' };

function TopicList(props: { topics: TopicListItem[]; onOpen: (id: string) => void }) {
  return (
    <div style={paneStyle}>
      {(['needs_you', 'quiet'] as const).map((group) => (
        <div key={group}>
          <h4>{group === 'needs_you' ? 'Needs you' : 'Quiet'}</h4>
          {props.topics
            .filter((item) => item.group === group)
            .map((item) => (
              <div key={item.topic.id} onClick={() => props.onOpen(item.topic.id)} style={{ cursor: 'pointer' }}>
                {item.topic.name} ({item.unreadTiles})
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

function TopicPane(props: { topic: TopicDetail | null; onOpenPr: (prKey: string) => void }) {
  if (!props.topic) {
    return <div style={paneStyle}>No topic open</div>;
  }
  return (
    <div style={paneStyle}>
      <h3>{props.topic.topic.name}</h3>
      <p>{props.topic.topic.summary}</p>
      {props.topic.tiles.map((view) => (
        <div key={view.tile.id} style={{ border: '1px solid #ddd', margin: '6px 0', padding: 6 }}>
          <div>
            [{view.tile.kind}] {view.tile.title} - {view.state.kind}
          </div>
          {view.state.unreadBecause.map((reason) => (
            <div key={reason.eventId}>unread: {reason.summary}</div>
          ))}
          {view.prs.map((pr) => (
            <div key={pr.key} onClick={() => props.onOpenPr(pr.key)} style={{ cursor: 'pointer' }}>
              {pr.key} {pr.title} ({pr.provenance.kind}, {pr.verdict ?? 'no glance'})
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function PrPane(props: { pr: PrDetail | null }) {
  if (!props.pr) {
    return <div style={paneStyle}>No PR open</div>;
  }
  const { pr, glance, events } = props.pr;
  return (
    <div style={paneStyle}>
      <h3>
        {pr.key} {pr.title}
      </h3>
      {glance && (
        <div>
          <b>{glance.verdict}</b> {glance.forYou}
        </div>
      )}
      {events.map((view) => (
        <div key={view.event.id}>
          [{view.display}] {view.event.summary}
        </div>
      ))}
    </div>
  );
}

export function App() {
  const [topics, setTopics] = useState<TopicListItem[]>([]);
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [pr, setPr] = useState<PrDetail | null>(null);
  const [error, setError] = useState('');

  function run(task: Promise<unknown>) {
    task.catch((reason: unknown) => setError(String(reason)));
  }

  function reloadTopics() {
    run(api.listTopics().then(setTopics));
  }

  useEffect(reloadTopics, []);

  return (
    <div style={{ fontFamily: 'system-ui', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #ccc' }}>
        <button onClick={() => run(api.sync().then(reloadTopics))}>Sync now</button> {error}
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 2fr 2fr', minHeight: 0 }}>
        <TopicList topics={topics} onOpen={(id) => run(api.getTopic(id).then(setTopic))} />
        <TopicPane topic={topic} onOpenPr={(key) => run(api.getPr(key).then(setPr))} />
        <PrPane pr={pr} />
      </div>
    </div>
  );
}
