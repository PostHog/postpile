import type { ActionResult, TopicDetail, TopicListItem } from '@code-manager/core';
import * as api from './api.ts';
import { TileCard } from './TileCard.tsx';
import { paneStyle } from './styles.ts';

interface TopicPaneProps {
  detail: TopicDetail | null;
  topics: TopicListItem[];
  act: (task: Promise<ActionResult>) => void;
  onError: (reason: unknown) => void;
  onOpenPr: (prKey: string) => void;
}

export function TopicPane(props: TopicPaneProps) {
  if (!props.detail) {
    return <div style={paneStyle}>No topic open</div>;
  }
  const { topic, tiles, pendingProposals } = props.detail;
  return (
    <div style={paneStyle}>
      <h3>{topic.name}</h3>
      <div>
        driver: {topic.driver ?? 'unknown'}, you: {topic.userRole}
      </div>
      <p>{topic.summary}</p>
      {topic.tailoring && <p>You told the agent: {topic.tailoring}</p>}
      {pendingProposals.map((proposal) => (
        <div key={proposal.id}>
          Agent proposes {proposal.kind} {proposal.name ?? ''}: {proposal.reason}{' '}
          <button onClick={() => props.act(api.decideTopicProposal(proposal.id, true))}>Accept</button>
          <button onClick={() => props.act(api.decideTopicProposal(proposal.id, false))}>Reject</button>
        </div>
      ))}
      {tiles.length === 0 && <p>Nothing pinged you here.</p>}
      {tiles.map((view) => (
        <TileCard key={view.tile.id} view={view} topics={props.topics} act={props.act} onError={props.onError} onOpenPr={props.onOpenPr} />
      ))}
    </div>
  );
}
