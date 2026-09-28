import type { SetupDraft } from '@postpile/core';
import { repoChoices, repoCountText } from '../lib/setup.ts';
import { SetupChip } from './SetupChip.tsx';

/**
 * Quiet repos (toggles) and the main repo (radios), prefilled from the
 * draft's suggestions. Quiet repos still sync but never make a topic urgent
 * or ping; the main repo becomes the title bar's repo scope.
 */
export function SetupRepoChoices(props: {
  draft: SetupDraft;
  quiet: string[];
  onQuiet: (repo: string, quiet: boolean) => void;
  mainRepo: string | null;
  onMainRepo: (repo: string | null) => void;
}) {
  const repos = repoChoices(props.draft);
  const quietWhy = new Map(props.draft.quietRepos.map((pick) => [pick.repo, pick.why]));
  const mainSuggested = props.draft.mainRepo?.repo ?? null;
  if (repos.length === 0) {
    return <p className="text-xs text-faint">The sweep found no repos with your activity, so there is nothing to pick here.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[12.5px] font-semibold text-ink">Quiet repos</legend>
        <p className="mb-1 text-[11px] text-muted">Still synced and remembered, but never urgent and never a ping.</p>
        {repos.map((repo) => {
          const why = quietWhy.get(repo.repo);
          return (
            <label
              key={repo.repo}
              className="flex items-start gap-2 rounded-control px-1 py-1 hover:bg-subtle"
              title={repo.repo === props.mainRepo ? 'Your main repo cannot also be quiet' : why}
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-accent"
                checked={props.quiet.includes(repo.repo)}
                disabled={repo.repo === props.mainRepo}
                onChange={(event) => props.onQuiet(repo.repo, event.target.checked)}
              />
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-1.5">
                  <span className="truncate font-mono text-[11px] text-ink">{repo.repo}</span>
                  {why && <SetupChip tone="quiet" word="suggested" />}
                </span>
                <span className="text-[10.5px] text-faint">{why ?? repoCountText(repo)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-[12.5px] font-semibold text-ink">Main repo</legend>
        <p className="mb-1 text-[11px] text-muted">The sidebar shows topics with a PR in it. The title bar menu changes it any time.</p>
        <label className="flex items-center gap-2 rounded-control px-1 py-1 hover:bg-subtle">
          <input type="radio" name="setup-main-repo" className="accent-accent" checked={props.mainRepo === null} onChange={() => props.onMainRepo(null)} />
          <span className="text-xs text-ink">All repos</span>
        </label>
        {repos.map((repo) => (
          <label key={repo.repo} className="flex items-start gap-2 rounded-control px-1 py-1 hover:bg-subtle">
            <input
              type="radio"
              name="setup-main-repo"
              className="mt-0.5 accent-accent"
              checked={props.mainRepo === repo.repo}
              onChange={() => props.onMainRepo(repo.repo)}
            />
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-mono text-[11px] text-ink">{repo.repo}</span>
                {repo.repo === mainSuggested && <SetupChip tone="quiet" word="suggested" />}
              </span>
              <span className="text-[10.5px] text-faint">{repo.repo === mainSuggested ? props.draft.mainRepo?.why : repoCountText(repo)}</span>
            </span>
          </label>
        ))}
      </fieldset>
    </div>
  );
}
