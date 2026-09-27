import { useState } from 'react';
import type { ActionResult, SnoozeCondition, TileView, TopicListItem } from '@code-manager/core';
import * as api from './api.ts';
import { TileChat } from './TileChat.tsx';
import { cardStyle, clickable } from './styles.ts';

const snoozeOptions: Record<string, () => SnoozeCondition> = {
  'someone replies': () => ({ kind: 'someone_replies' }),
  'new push': () => ({ kind: 'new_push' }),
  'CI green': () => ({ kind: 'ci_green' }),
  '1 hour': () => ({ kind: 'until_time', until: new Date(Date.now() + 3_600_000).toISOString() }),
};

interface TileCardProps {
  view: TileView;
  topics: TopicListItem[];
  act: (task: Promise<ActionResult>) => void;
  onError: (reason: unknown) => void;
  onOpenPr: (prKey: string) => void;
}

export function TileCard(props: TileCardProps) {
  const { tile, state, prs } = props.view;
  const [chatOpen, setChatOpen] = useState(false);
  const otherTopics = props.topics.filter((item) => item.topic.id !== tile.topicId);

  function snooze(label: string) {
    const condition = snoozeOptions[label];
    if (condition) {
      props.act(api.snooze(tile.id, condition()));
    }
  }

  function feedback(kind: 'not_mine' | 'not_related' | 'wrong_topic', prKey: string | null, targetTopicId: string | null) {
    props.act(api.giveFeedback({ kind, tileId: tile.id, prKey, targetTopicId, note: '' }));
  }

  return (
    <div style={cardStyle}>
      <div>
        [{tile.kind}] {tile.title} - <b>{state.kind}</b>
      </div>
      {state.unreadBecause.map((reason) => (
        <div key={reason.eventId}>unread: {reason.summary}</div>
      ))}
      {prs.map((pr) => (
        <div key={pr.key}>
          <span onClick={() => props.onOpenPr(pr.key)} style={clickable}>
            {pr.key} {pr.title} ({pr.provenance.kind}, {pr.verdict ?? 'no glance'})
          </span>
          {pr.provenance.kind === 'pulled_in' && <i> {pr.provenance.reason}</i>}
          {tile.kind === 'set' && pr.provenance.kind === 'pulled_in' && (
            <button onClick={() => feedback('not_related', pr.key, null)}>Not related</button>
          )}
        </div>
      ))}
      <div>
        <button onClick={() => props.act(api.markRead(tile.id))}>Mark read</button>
        {state.kind === 'snoozed' ? (
          <button onClick={() => props.act(api.unsnooze(tile.id))}>Unsnooze</button>
        ) : (
          <select value="" onChange={(event) => snooze(event.target.value)}>
            <option value="">Snooze until...</option>
            {Object.keys(snoozeOptions).map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
        )}
        <button onClick={() => feedback('not_mine', null, null)}>Not mine</button>
        <select value="" onChange={(event) => feedback('wrong_topic', null, event.target.value)}>
          <option value="">Wrong topic, move to...</option>
          {otherTopics.map((item) => (
            <option key={item.topic.id} value={item.topic.id}>
              {item.topic.name}
            </option>
          ))}
        </select>
        <button onClick={() => setChatOpen(!chatOpen)}>Chat</button>
      </div>
      {chatOpen && <TileChat tileId={tile.id} act={props.act} onError={props.onError} />}
    </div>
  );
}
