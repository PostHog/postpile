import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useActions } from '../api/actions.tsx';
import { queryKeys } from '../api/keys.ts';
import { useSyncProgress } from '../api/sync.ts';

/**
 * Covers the window while the one-time topic tidy after an upgrade runs
 * (DESIGN.md "Topic tidy after an upgrade"). Topics merge and split for a
 * minute or two; a click meanwhile could land on a topic that is about to
 * move. When the sync's tidy phase ends, the cover stays until the app has
 * refetched what it shows: the rest of the sync can take minutes, and until
 * it ends the cached topics are still the ones from before the tidy.
 */
export function TidyOverlay() {
  const actions = useActions();
  const queryClient = useQueryClient();
  const progress = useSyncProgress(actions.syncing).data;
  const tidying = progress?.running.includes('tidy') ?? false;
  const wasTidying = useRef(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (tidying) {
      wasTidying.current = true;
      return;
    }
    if (!wasTidying.current) {
      return;
    }
    wasTidying.current = false;
    setRefreshing(true);
    // Everything but the config, like a refresh after an action.
    void queryClient
      .invalidateQueries({ predicate: (query) => query.queryKey[0] !== queryKeys.config[0] })
      .finally(() => setRefreshing(false));
  }, [tidying, queryClient]);

  if (!tidying && !refreshing) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 backdrop-blur-[2px]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Tidying up your topics and tiles"
        className="flex w-[420px] max-w-[calc(100vw-32px)] flex-col items-center gap-3 rounded-tile bg-surface p-6 text-center shadow-menu"
      >
        <span className="size-6 animate-spin rounded-full border-2 border-hairline-strong border-t-accent" aria-hidden="true" />
        <h2 className="text-[14px] font-semibold text-ink">Tidying up your topics and tiles</h2>
        <p className="text-xs leading-relaxed text-muted">
          This update sizes topics like projects. Once, PostPile merges topics that are too small and splits ones that are too broad. PRs you moved by hand stay where you put them. This takes a minute or two.
        </p>
      </div>
    </div>
  );
}
