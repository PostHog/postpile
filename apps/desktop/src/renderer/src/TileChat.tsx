import { useEffect, useState } from 'react';
import type { ActionResult, ChatMessage, TailoringProposal } from '@code-manager/core';
import * as api from './api.ts';

export function TileChat(props: { tileId: string; act: (task: Promise<ActionResult>) => void; onError: (reason: unknown) => void }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [proposal, setProposal] = useState<TailoringProposal | null>(null);

  function reload() {
    api.getChat(props.tileId).then(setMessages).catch(props.onError);
  }

  useEffect(reload, [props.tileId]);

  function send() {
    api
      .chat(props.tileId, draft)
      .then((reply) => {
        setDraft('');
        setProposal(reply.tailoringProposal);
        reload();
      })
      .catch(props.onError);
  }

  function decide(keep: boolean) {
    if (proposal) {
      props.act(api.decideTailoring(proposal.topicId, proposal.text, keep));
      setProposal(null);
    }
  }

  return (
    <div style={{ marginTop: 6, paddingLeft: 8, borderLeft: '2px solid #ccc' }}>
      {messages.map((message) => (
        <div key={message.id}>
          <b>{message.role}:</b> {message.text}
        </div>
      ))}
      {proposal && (
        <div>
          Keep as topic instruction? "{proposal.text}"{' '}
          <button onClick={() => decide(true)}>Keep it</button>
          <button onClick={() => decide(false)}>Just this once</button>
        </div>
      )}
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Tell the agent..." />
      <button disabled={!draft} onClick={send}>
        Send
      </button>
    </div>
  );
}
