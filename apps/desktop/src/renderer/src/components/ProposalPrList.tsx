/** The PRs a split or move takes along, so the user knows what Accept moves. */
export function ProposalPrList(props: { named: string[]; stackLayers: number }) {
  return (
    <ul className="flex flex-col gap-0.5 text-[12px] leading-normal text-ink-2 select-text">
      {props.named.map((label) => (
        <li key={label} className="truncate">
          {label}
        </li>
      ))}
      {props.stackLayers > 0 && (
        <li className="text-muted">
          + {props.stackLayers} stack {props.stackLayers === 1 ? 'layer' : 'layers'} that {props.stackLayers === 1 ? 'comes' : 'come'} along
        </li>
      )}
    </ul>
  );
}
