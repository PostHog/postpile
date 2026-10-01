import type { DossierRefs } from '../dossier-refs.ts';
import type { TopicDigestInput } from '../service.ts';
import { DOSSIER_ANSWER_FIELDS, dossierUpdateInstructions } from './dossier-update.ts';
import { GLANCE_ENTRY_SHAPE, glanceRules, glanceSections } from './glance-batch.ts';
import { jsonOnly } from './shared.ts';

/**
 * One call per topic (DESIGN.md "One call per topic"): the dossier update
 * word for word, then the glances of the topic's most urgent PRs. Thinking is
 * off, so the order of the answer is the order of the work: the dossier comes
 * first and the glances read it. User memory, viewer and the GitHub data rule
 * are in the dossier part and are not repeated.
 */
export function topicDigestPrompt(input: TopicDigestInput, refs: DossierRefs): string {
  const count = input.glances.items.length;
  return `${dossierUpdateInstructions(input.dossier, refs)}

Second part of the job: after the dossier, help the developer decide at a glance what to do about
${count} pull ${count === 1 ? 'request' : 'requests'} of this same topic. Read each one against the dossier you just
wrote and against what the user cares about.

The pull requests, each headed by its key:

${glanceSections(input.glances)}

${glanceRules(input.glances)}

Write the answer in this order: the dossier fields first, then "glances".
${jsonOnly(`{\n${DOSSIER_ANSWER_FIELDS},\n  "glances": [${GLANCE_ENTRY_SHAPE}]\n}`)}`;
}
