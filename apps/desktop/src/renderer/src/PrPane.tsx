import { useState } from 'react';
import type { ActionResult, PrDetail } from '@code-manager/core';
import * as api from './api.ts';
import { paneStyle } from './styles.ts';

interface PrPaneProps {
  detail: PrDetail | null;
  act: (task: Promise<ActionResult>) => void;
  onError: (reason: unknown) => void;
}

function AskBox(props: PrPaneProps & { detail: PrDetail }) {
  const { pr } = props.detail;
  const [person, setPerson] = useState(pr.author);
  const [intent, setIntent] = useState('');
  const [body, setBody] = useState<string | null>(null);

  function draft() {
    api
      .draftAsk(pr.key, person, intent)
      .then((result) => setBody(result.body))
      .catch(props.onError);
  }

  function send() {
    if (body) {
      props.act(api.sendComment(pr.key, body));
      setBody(null);
    }
  }

  return (
    <div>
      Ask <input value={person} onChange={(event) => setPerson(event.target.value)} size={10} />
      <input value={intent} onChange={(event) => setIntent(event.target.value)} placeholder="about what?" />
      <button onClick={draft}>Draft</button>
      {body !== null && (
        <div>
          <textarea value={body} onChange={(event) => setBody(event.target.value)} rows={4} cols={60} />
          <div>
            <button onClick={send}>Send comment</button>
            <button onClick={() => setBody(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function PrPane(props: PrPaneProps) {
  if (!props.detail) {
    return <div style={paneStyle}>No PR open</div>;
  }
  const { pr, glance, events, userState } = props.detail;
  return (
    <div style={paneStyle}>
      <h3>
        {pr.key} {pr.title}
      </h3>
      <div>
        {pr.state} by {pr.author}, +{pr.additions} -{pr.deletions}, CI {pr.checks.rollup} <a href={pr.url} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </div>
      {glance && (
        <div>
          <p>
            <b>{glance.verdict}</b> {glance.forYou}
          </p>
          <div>does: {glance.does}</div>
          <div>risk: {glance.risk}</div>
          <div>others said: {glance.othersSaid}</div>
          {glance.pullInReason && <div>pulled in: {glance.pullInReason}</div>}
        </div>
      )}
      <p>
        {userState?.approvedAt ? (
          <span>You approved.</span>
        ) : (
          <button onClick={() => props.act(api.approve(pr.key))}>Approve (cannot be undone)</button>
        )}
      </p>
      <AskBox {...props} detail={props.detail} />
      <h4>Activity</h4>
      {events.map((view) => (
        <div key={view.event.id} style={{ color: view.display === 'seen' || view.display === 'muted' ? '#888' : 'inherit' }}>
          [{view.display}] {view.event.summary}
          {view.display === 'muted' && <button onClick={() => props.act(api.unmuteEvent(view.event.id))}>Unmute</button>}
        </div>
      ))}
    </div>
  );
}
