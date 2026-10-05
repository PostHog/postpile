import { SETUP_STEPS, type SetupStepKey } from '../lib/setup.ts';

/** "1 Check the basics · 2 Sweep · 3 Review the draft · 4 Your day · 5 Accept": done steps sea, the current one ink, the rest quiet. */
export function SetupSteps(props: { current: SetupStepKey }) {
  const currentIndex = SETUP_STEPS.findIndex((step) => step.key === props.current);
  return (
    <ol aria-label="Setup steps" className="flex flex-wrap items-center gap-1.5">
      {SETUP_STEPS.map((step, index) => {
        const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'next';
        const tone = {
          done: 'bg-sea-soft text-sea-ink',
          current: 'bg-ink text-on-ink',
          next: 'bg-quiet-soft text-muted',
        }[state];
        return (
          <li key={step.key} aria-current={state === 'current' ? 'step' : undefined} className="flex items-center gap-1.5">
            {index > 0 && <span className="h-px w-4 bg-hairline-strong" />}
            <span className={`flex h-6 items-center gap-1.5 rounded-full pr-2.5 pl-1.5 text-[11.5px] font-medium ${tone}`}>
              <span className="font-mono text-[10.5px] opacity-80">{index + 1}</span>
              {step.label}
              {state === 'done' && <span className="text-[10.5px] font-normal opacity-80">· done</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
