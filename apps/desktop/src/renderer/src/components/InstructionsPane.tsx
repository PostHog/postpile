import type { ReactNode } from 'react';
import { useInstructions } from '../api/instructions.ts';
import { useSetupStatus } from '../api/setup.ts';
import { useTeamRoles } from '../api/team-roles.ts';
import { Button } from './Button.tsx';
import { InstructionsChat } from './InstructionsChat.tsx';
import { InstructionsFileLine } from './InstructionsFileLine.tsx';
import { InstructionsText } from './InstructionsText.tsx';
import { InstructionsVersions } from './InstructionsVersions.tsx';
import { TeamRolesList } from './TeamRolesList.tsx';
import { WorkContextSection } from './WorkContextSection.tsx';

function Section(props: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="flex max-w-[680px] flex-col gap-2 rounded-tile bg-surface p-3.5 shadow-tile">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[12.5px] font-semibold text-ink">{props.title}</h2>
        {props.meta && <span className="font-mono text-[10.5px] text-faint">{props.meta}</span>}
      </div>
      {props.children}
    </section>
  );
}

/**
 * "Your teams": home or routing only per GitHub team, with a flip each
 * (DESIGN.md "Team roles"). Here because it is the user's say about how the
 * app reads their world, like the instructions; there is no settings screen.
 */
function TeamsSection() {
  const roles = useTeamRoles();
  const teams = roles.data?.teams ?? [];
  return (
    <Section title="Your teams">
      <p className="text-[11.5px] text-muted">
        A home team's members are your teammates: Your team owns, the team PRs filter, "For you" on their PRs. A routing-only team just brings you its review requests
        and mentions. Decided from how your reviews of the last 90 days reached you; a change here sticks.
      </p>
      {roles.error && <p className="text-xs text-status-bad">Could not load your teams: {roles.error.message}</p>}
      {roles.data && teams.length === 0 && <p className="text-xs text-faint">No teams visible to your GitHub token yet.</p>}
      {teams.length > 0 && <TeamRolesList teams={teams} />}
    </Section>
  );
}

/**
 * Middle pane for "Your instructions": the user's own text, read-only here,
 * a chat that proposes changes as diffs, and every version with where it
 * came from. The agent never changes this text without an Accept. Below it,
 * set apart, the agent-written "What you're working on".
 */
/** After "Skip for now": a quiet reminder that setup can still write a first draft. */
function SkippedSetupBanner(props: { onRunSetup: () => void }) {
  return (
    <div className="flex max-w-[680px] items-center gap-3 rounded-tile border border-honey bg-honey-soft px-3.5 py-2.5 text-xs text-honey-ink">
      <span>You skipped setup. It drafts these instructions from your recent GitHub activity; you review before anything is saved.</span>
      <Button className="ml-auto" onClick={props.onRunSetup}>
        Run setup
      </Button>
    </div>
  );
}

export function InstructionsPane(props: { onOpenTopic: (topicId: string) => void; onRunSetup: () => void }) {
  const instructions = useInstructions();
  const setup = useSetupStatus();
  const data = instructions.data;
  const skipped = setup.data?.flag === 'skipped';
  return (
    <main className="pane-scroll flex min-w-0 flex-col gap-[18px] overflow-auto pl-[26px] pr-[16px] py-[22px]">
      <div className="flex flex-col gap-1.5">
        <div className="flex max-w-[680px] items-center gap-3">
          <h1 className="text-[23px] leading-tight font-[650] tracking-[-0.022em]">Your instructions</h1>
          {/* After a skip the banner below holds the one "Run setup"; two buttons for one flow read as two actions. */}
          {!skipped && (
            <Button
              className="ml-auto"
              onClick={props.onRunSetup}
              title="The agent drafts your instructions from your recent GitHub activity, ownership files and work context. Shown as a diff; nothing changes until you accept."
            >
              Run setup again
            </Button>
          )}
        </div>
        <p className="max-w-[680px] text-[13px] text-ink-2">
          What the agent knows about you and how you work, in your words. It goes into every prompt, above anything the agent learned. The agent only
          proposes changes; nothing changes until you accept.
        </p>
        {data && <InstructionsFileLine path={data.path} />}
      </div>
      {skipped && <SkippedSetupBanner onRunSetup={props.onRunSetup} />}
      {instructions.error && <p className="text-xs text-status-bad">Could not load your instructions: {instructions.error.message}</p>}
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
      <TeamsSection />
      <WorkContextSection onOpenTopic={props.onOpenTopic} />
    </main>
  );
}
