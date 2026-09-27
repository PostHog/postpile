/** One rendered line of instructions.md: headings and bullets are all the structure it needs. */
function Line(props: { text: string }) {
  const { text } = props;
  const heading = /^#{1,6}\s+(.*)$/.exec(text);
  if (heading) {
    return <h3 className="pt-2 text-[12.5px] font-semibold text-ink first:pt-0">{heading[1]}</h3>;
  }
  const bullet = /^\s*[-*]\s+(.*)$/.exec(text);
  if (bullet) {
    return (
      <p className="flex gap-2 pl-1 text-[12.5px] leading-normal text-ink-2">
        <span className="text-faint">•</span>
        <span>{bullet[1]}</span>
      </p>
    );
  }
  if (text.trim() === '') {
    return <span className="h-1.5" />;
  }
  return <p className="text-[12.5px] leading-normal text-ink-2">{text}</p>;
}

/** The current instructions, read-only. */
export function InstructionsText(props: { text: string }) {
  if (props.text.trim() === '') {
    return <p className="text-xs text-faint">No instructions yet. Tell the agent below what matters to you, or write the file by hand.</p>;
  }
  return (
    <div className="flex flex-col gap-0.5 select-text">
      {props.text.split('\n').map((line, index) => (
        <Line key={index} text={line} />
      ))}
    </div>
  );
}
