import type { ReactNode } from 'react';
import { useInstructions } from '../api/instructions.ts';
import { InstructionsChat } from './InstructionsChat.tsx';
import { InstructionsFileLine } from './InstructionsFileLine.tsx';
import { InstructionsText } from './InstructionsText.tsx';
import { InstructionsVersions } from './InstructionsVersions.tsx';

function Section(props: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="flex max-w-[680px] flex-col gap-2 rounded-tile border border-hairline bg-surface p-3.5 shadow-tile">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">{props.title}</h2>
        {props.meta && <span className="font-mono text-[10.5px] text-faint">{props.meta}</span>}
      </div>
      {props.children}
    </section>
  );
}

/**
 * Middle pane for "Your instructions": the user's own text, read-only here,
 * a chat that proposes changes as diffs, and every version with where it
 * came from. The agent never changes this text without an Accept.
 */
export function InstructionsPane() {
  const instructions = useInstructions();
  const data = instructions.data;
  return (
    <main className="flex min-w-0 flex-col gap-[18px] overflow-auto px-[26px] py-[22px]">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[23px] leading-tight font-[650] tracking-[-0.022em]">Your instructions</h1>
        <p className="max-w-[680px] text-[13px] text-ink-2">
          What the agent knows about you and how you work, in your words. It goes into every prompt, above anything the agent learned. The agent only
          proposes changes; nothing changes until you accept.
        </p>
        {data && <InstructionsFileLine path={data.path} />}
      </div>
      {instructions.error && <p className="text-xs text-unread-ink">Could not load your instructions: {instructions.error.message}</p>}
      <Section title="Change something">
        <InstructionsChat />
      </Section>
      {data && (
        <Section title="Current text" meta={data.version === null ? undefined : `v${data.version}`}>
          <InstructionsText text={data.text} />
        </Section>
      )}
      {data && (
        <Section title="Version history">
          <InstructionsVersions versions={data.versions} />
        </Section>
      )}
    </main>
  );
}
