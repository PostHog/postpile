import { SETUP_STEPS, type SetupStepKey } from '../lib/setup.ts';

/** The sidebar while setup runs: no topics yet, only where the flow stands. */
export function SetupSidebar(props: { step: SetupStepKey }) {
  const currentIndex = SETUP_STEPS.findIndex((step) => step.key === props.step);
  return (
    <nav aria-label="Setup" className="pane-scroll flex min-h-0 flex-col gap-2 overflow-auto border-r border-hairline-strong bg-sidebar px-2.5 pt-3 pb-2.5">
      <p className="px-2.5 text-[12.5px] font-semibold text-ink">Setting up</p>
      <p className="px-2.5 text-[11.5px] leading-relaxed text-muted">
        Step {currentIndex + 1} of {SETUP_STEPS.length}: {SETUP_STEPS[currentIndex]?.label}. Topics show up here after the first sync.
      </p>
    </nav>
  );
}
