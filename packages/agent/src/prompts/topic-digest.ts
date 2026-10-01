import type { DossierRefs } from '../dossier-refs.ts';
import type { TopicDigestInput } from '../service.ts';
import { DOSSIER_ANSWER_FIELDS, dossierUpdateInstructions } from './dossier-update.ts';
import { GLANCE_ENTRY_SHAPE, glanceRules, glanceSections } from './glance-batch.ts';
import { SET_ANSWER_FIELDS, SET_RULES, setGroupingSections } from './sets.ts';
import { contextBlock, jsonOnly } from './shared.ts';

/** The third part, when a regroup is due: the topic's sets, read with the risk just written. */
function setsPart(input: TopicDigestInput): string {
  if (!input.sets) {
    return '';
  }
  return `

Third part of the job: keep the topic's sets. A tile is how the developer handles PRs in one go;
most PRs are a tile of their own, a set is a tile of two or more PRs. Where you wrote a glance above,
its risk counts instead of the risk shown here.

${setGroupingSections(input.sets)}

${SET_RULES}`;
}

function answerShape(input: TopicDigestInput): string {
  const sets = input.sets ? `,\n  "sets": {${SET_ANSWER_FIELDS}}` : '';
  return `{\n${DOSSIER_ANSWER_FIELDS},\n  "glances": [${GLANCE_ENTRY_SHAPE}]${sets}\n}`;
}

/**
 * One call per topic (DESIGN.md "One call per topic"): the dossier update
 * word for word, then the glances of the topic's most urgent PRs, then the
 * set changes when a regroup is due. Thinking is off, so the order of the
 * answer is the order of the work: the glances read the dossier, the sets
 * read the glances' risk. Viewer, glossary and the GitHub data rule are in
 * the dossier part and are not repeated. The user's instructions are: far
 * above in a long prompt they lost weight, and on a fresh start the
 * combined call said NOT_YOURS 3 times where separate glances said it 14
 * times (2026-10-01).
 */
export function topicDigestPrompt(input: TopicDigestInput, refs: DossierRefs): string {
  const count = input.glances.items.length;
  return `${dossierUpdateInstructions(input.dossier, refs)}

Second part of the job: after the dossier, help the developer decide at a glance what to do about
${count} pull ${count === 1 ? 'request' : 'requests'} of this same topic. Read each one against the dossier you just
wrote and against what the user cares about. The user's own words once more, since each verdict
(NOT_YOURS above all) is judged by them:
${contextBlock(input.glances.context)}
The pull requests, each headed by its key:

${glanceSections(input.glances)}

${glanceRules(input.glances)}${setsPart(input)}

Write the answer in this order: the dossier fields first, then "glances"${input.sets ? ', then "sets"' : ''}.
${jsonOnly(answerShape(input))}`;
}
