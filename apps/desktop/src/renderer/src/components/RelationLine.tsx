import { useState } from 'react';
import type { TopicPlacement, TopicRelation } from '@postpile/core';
import { useActions } from '../api/actions.tsx';
import { relationLabel } from '../lib/sidebar.ts';
import { RelationBadge } from './pills.tsx';
import { WhyPanel } from './WhyPanel.tsx';

const OTHER_RELATIONS: Record<TopicRelation, TopicRelation[]> = {
  team: ['routed', 'fyi'],
  routed: ['team', 'fyi'],
  fyi: ['team', 'routed'],
};

function lineText(placement: TopicPlacement): string {
  const owner = placement.ownerTeam ? `Owned by ${placement.ownerTeam}` : 'Owner not known';
  return placement.whyYou ? `${owner} · you're here because ${placement.whyYou}` : owner;
}

/**
 * "Owned by X · you're here because Y" with the relation badge, "Why?" and
 * the correction: "Wrong" offers the other two relations. A correction holds
 * until something new happens in the topic.
 */
export function RelationLine(props: { placement: TopicPlacement; topicId: string; dossierVersion: number | null; updating: boolean }) {
  const actions = useActions();
  const [whyOpen, setWhyOpen] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const { placement } = props;
  const text = lineText(placement);

  async function correct(relation: TopicRelation) {
    setChoosing(false);
    await actions.correctMemory({ kind: 'wrong', factId: null, topicId: props.topicId, text, relation });
  }

  return (
    <div>
      <div className="group flex items-start gap-2 text-[11.5px] leading-normal text-hint">
        <p className="min-w-0 flex-1 select-text">
          <RelationBadge relation={placement.relation} />
          <span className="pl-[7px]">
            {placement.ownerTeam ? (
              <>
                Owned by <span className="text-ink-2">{placement.ownerTeam}</span>
              </>
            ) : (
              'Owner not known'
            )}
          </span>
          {placement.whyYou && (
            <>
              <span className="px-[5px] text-ghost">·</span>
              you're here because {placement.whyYou}
            </>
          )}
          {placement.corrected && <span className="pl-2 text-[10.5px] whitespace-nowrap">set by you</span>}
        </p>
        <span className={`flex shrink-0 gap-2 group-hover:opacity-100 ${whyOpen || choosing ? 'opacity-100' : 'opacity-0'}`}>
          {props.dossierVersion !== null && (
            <button type="button" aria-expanded={whyOpen} onClick={() => setWhyOpen(!whyOpen)} className="text-[11px] text-hint hover:text-accent hover:underline">
              Why?
            </button>
          )}
          <button
            type="button"
            aria-expanded={choosing}
            title="Say where this topic really belongs. Stays in local memory, nothing goes to GitHub."
            onClick={() => setChoosing(!choosing)}
            className="text-[11px] text-hint hover:text-status-bad hover:underline"
          >
            Wrong
          </button>
        </span>
      </div>
      {choosing && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
          It is actually:
          {OTHER_RELATIONS[placement.relation].map((relation) => (
            <button
              key={relation}
              type="button"
              disabled={actions.isBusy(`correct:${text}`)}
              onClick={() => void correct(relation)}
              className="rounded border border-control bg-surface px-1.5 py-0.5 text-ink-2 hover:border-accent-line hover:text-accent"
            >
              {relation === 'team' ? 'your team' : relationLabel(relation)}
            </button>
          ))}
        </div>
      )}
      {whyOpen && props.dossierVersion !== null && (
        <WhyPanel target={{ kind: 'dossier_line', topicId: props.topicId, version: props.dossierVersion, path: 'relation' }} updating={props.updating} onClose={() => setWhyOpen(false)} />
      )}
    </div>
  );
}
