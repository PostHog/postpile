// Placeholder UI. It proves data and actions flow through the API into three
// panes; layout and styling are not decided yet.
import { useEffect, useState } from 'react';
import type { ActionResult, PrDetail, TopicDetail, TopicListItem } from '@code-manager/core';
import * as api from './api.ts';
import { PrPane } from './PrPane.tsx';
import { TopicList } from './TopicList.tsx';
import { TopicPane } from './TopicPane.tsx';

// Matches the engine's undo window for deferred mark-read.
const UNDO_VISIBLE_MS = 6000;

function Notice(props: { result: ActionResult | null; error: string; onUndo: (token: string) => void }) {
  if (props.error) {
    return <span style={{ color: 'crimson' }}>{props.error}</span>;
  }
  if (!props.result) {
    return null;
  }
  const { message, undoToken } = props.result;
  return (
    <span>
      {message} {undoToken && <button onClick={() => props.onUndo(undoToken)}>Undo</button>}
    </span>
  );
}

export function App() {
  const [topics, setTopics] = useState<TopicListItem[]>([]);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [prKey, setPrKey] = useState<string | null>(null);
  const [pr, setPr] = useState<PrDetail | null>(null);
  const [notice, setNotice] = useState<ActionResult | null>(null);
  const [error, setError] = useState('');

  function onError(reason: unknown) {
    setError(String(reason));
  }

  function refresh() {
    setError('');
    api.listTopics().then(setTopics).catch(onError);
    if (topicId) {
      api.getTopic(topicId).then(setTopic).catch(onError);
    }
    if (prKey) {
      api.getPr(prKey).then(setPr).catch(onError);
    }
  }

  function act(task: Promise<ActionResult>) {
    task
      .then((result) => {
        setNotice(result);
        refresh();
      })
      .catch(onError);
  }

  useEffect(refresh, [topicId, prKey]);

  useEffect(() => {
    if (!notice?.undoToken) {
      return;
    }
    const timer = setTimeout(() => setNotice(null), UNDO_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  function syncNow() {
    api
      .sync()
      .then((report) => {
        setNotice({ ok: report.errors.length === 0, message: `synced, ${report.newEvents} new events`, undoToken: null });
        refresh();
      })
      .catch(onError);
  }

  return (
    <div style={{ fontFamily: 'system-ui', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 8, borderBottom: '1px solid #ccc' }}>
        <button onClick={syncNow}>Sync now</button> <Notice result={notice} error={error} onUndo={(token) => act(api.undo(token))} />
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 2fr 2fr', minHeight: 0 }}>
        <TopicList topics={topics} openTopicId={topicId} onOpen={setTopicId} />
        <TopicPane detail={topic} topics={topics} act={act} onError={onError} onOpenPr={setPrKey} />
        <PrPane detail={pr} act={act} onError={onError} />
      </div>
    </div>
  );
}
