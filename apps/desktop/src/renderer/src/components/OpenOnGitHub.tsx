import { buttonClasses, splitSeamClasses } from './Button.tsx';
import { ChevronIcon, ExternalIcon } from './icons.tsx';
import { Menu } from './Menu.tsx';

/** Where the arrow next to "Open on GitHub" can land, on top of the conversation the main part opens. */
const PLACES: { label: string; suffix: string }[] = [
  { label: 'Files changed', suffix: '/files' },
  { label: 'Commits', suffix: '/commits' },
  { label: 'Checks', suffix: '/checks' },
];

/**
 * The detail pane's one way to github.com, next to the PR's identity on the
 * state line: the PR's conversation, or from the arrow its files, commits
 * or checks. Ink when core says opening it is the move (own PR, done PR),
 * else outlined. The main process opens links in the browser.
 */
export function OpenOnGitHub(props: { url: string; leads: boolean }) {
  const variant = props.leads ? 'primary' : 'secondary';
  const items = PLACES.map((place) => ({
    label: place.label,
    onSelect: () => {
      window.open(`${props.url}${place.suffix}`, '_blank', 'noopener');
    },
  }));
  return (
    <div className="flex shrink-0">
      <a href={props.url} target="_blank" rel="noreferrer" title="Open the PR on github.com" className={`${buttonClasses(variant, 'sm')} rounded-r-none`}>
        Open on GitHub
        <ExternalIcon size={11} />
      </a>
      <Menu
        label={<ChevronIcon />}
        title="Open on GitHub at…"
        size="icon"
        variant={variant}
        align="right"
        buttonClassName={splitSeamClasses(variant)}
        items={items}
      />
    </div>
  );
}
