import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TileView } from '@code-manager/core';
import { useActions } from './api/actions.tsx';
import { useProposals } from './api/proposals.ts';
import { useSearch } from './api/search.ts';
import { useTopic, useTopics } from './api/topics.ts';
import { DetailPane } from './components/DetailPane.tsx';
import { InboxPane } from './components/InboxPane.tsx';
import { InstructionsPane } from './components/InstructionsPane.tsx';
import { NotificationsPane } from './components/NotificationsPane.tsx';
import { SearchField } from './components/SearchField.tsx';
import { TellAgentContext, type ChatRequest } from './components/TellAgent.tsx';
import { StatusFooter } from './components/StatusFooter.tsx';
import { TileGrid } from './components/TileGrid.tsx';
import { TitleBar } from './components/TitleBar.tsx';
import { Toast } from './components/Toast.tsx';
import { TopicHeader } from './components/TopicHeader.tsx';
import { TopicSidebar } from './components/TopicSidebar.tsx';
import { sameView, type NavEntry } from './lib/history.ts';
import { searchFilter, visibleTopic } from './lib/search.ts';
import { leadPr } from './lib/tiles.ts';
import { useNavHistory, useNavShortcuts } from './lib/use-nav-history.ts';

function MainPane(props: { children: ReactNode }) {
  return <main className="flex min-w-0 flex-col gap-[18px] overflow-auto px-5 py-[22px]">{props.children}</main>;
}

function EmptyMain(props: { text: string }) {
  return (
    <MainPane>
      <p className="m-auto max-w-sm text-center text-xs leading-relaxed text-muted">{props.text}</p>
    </MainPane>
  );
}

/**
 * The tile and PR the user picked, falling back to the first (shown) tile and
 * its first PR matching the search, else its lead PR.
 */
function resolveSelection(entry: NavEntry, tiles: TileView[], matchingPrKeys: Set<string> | null) {
  const view = tiles.find((candidate) => candidate.tile.id === entry.tileId) ?? tiles[0] ?? null;
  let prKey: string | null = null;
  if (view) {
    const picked = view.prs.find((pr) => pr.key === entry.prKey);
    const matching = matchingPrKeys ? view.prs.find((pr) => matchingPrKeys.has(pr.key)) : undefined;
    prKey = picked?.key ?? matching?.key ?? leadPr(view)?.key ?? null;
  }
  return { view, prKey };
}

export function App() {
  const actions = useActions();
  const topics = useTopics();
  const proposals = useProposals();

  const [query, setQuery] = useState('');
  // "Tell the agent what's wrong" from a memory line opens the selected tile's chat with a draft.
  const [chatRequest, setChatRequest] = useState<ChatRequest | null>(null);
  const search = useSearch(query);

  const items = topics.data ?? [];
  // Navigation is a back / forward history; the current entry is what the user picked.
  const nav = useNavHistory(new Set(items.map((item) => item.topic.id)));
  useNavShortcuts(nav.back, nav.forward);
  const pane = nav.current.pane;
  // A blank query filters nothing, even while react-query still holds the last answer.
  const filter = searchFilter(query.trim() === '' ? undefined : search.data);
  // When the filter hides the picked topic, the first match shows instead. That is
  // derived, not a navigation: history stays clean and clearing the filter
  // brings the picked topic back.
  const activeItem = visibleTopic(items, nav.current.topicId, filter);
  const topic = useTopic(activeItem?.topic.id ?? null);
  const matchingTileIds = activeItem && filter ? (filter.tilesByTopic.get(activeItem.topic.id) ?? new Set<string>()) : null;
  const shownTiles = (topic.data?.tiles ?? []).filter((view) => !matchingTileIds || matchingTileIds.has(view.tile.id));
  const selected = resolveSelection(nav.current, shownTiles, filter?.prKeys ?? null);
  // What is on screen after the fallbacks. Picking it again adds no history entry.
  const shown: NavEntry = { pane, topicId: activeItem?.topic.id ?? null, tileId: selected.view?.tile.id ?? null, prKey: selected.prKey };
  const go = (next: NavEntry) => {
    if (!sameView(shown, next)) {
      nav.navigate(next);
    }
  };
  const pickTile = (tileId: string, prKey: string) => go({ pane: 'topic', topicId: activeItem?.topic.id ?? null, tileId, prKey });
  const inboxCount = (proposals.data?.topics.length ?? 0) + (proposals.data?.rules.length ?? 0);

  // A topic counts as seen when the user leaves it: picks another topic, the
  // Inbox or their instructions. Simpler than a visibility timer, and the
  // "since you last looked" block stays put while they are still reading it.
  // This follows the picked topic, not the shown one, so a search filter that
  // hides the topic for a moment does not mark it seen.
  const shownTopicId = pane === 'topic' ? (activeItem?.topic.id ?? null) : null;
  const pickedTopicId = pane === 'topic' ? (visibleTopic(items, nav.current.topicId, null)?.topic.id ?? null) : null;
  const lastPickedTopicId = useRef<string | null>(null);
  useEffect(() => {
    const left = lastPickedTopicId.current;
    lastPickedTopicId.current = pickedTopicId;
    if (left !== null && left !== pickedTopicId) {
      void actions.markTopicSeen(left);
    }
  }, [pickedTopicId, actions]);

  // Sync once on app start; after that only on "Sync now". The ref keeps
  // React's dev double-mount from starting a second one.
  const syncedOnStart = useRef(false);
  useEffect(() => {
    if (!syncedOnStart.current) {
      syncedOnStart.current = true;
      void actions.sync();
    }
  }, [actions]);

  let main = <EmptyMain text="Loading…" />;
  if (pane === 'inbox') {
    main = <InboxPane proposals={proposals.data} topics={items} error={proposals.error?.message ?? null} />;
  } else if (pane === 'instructions') {
    main = <InstructionsPane />;
  } else if (pane === 'notifications') {
    // A jump goes through go(), so back returns to this list.
    main = <NotificationsPane onOpenTile={(pick) => go({ pane: 'topic', topicId: pick.topicId, tileId: pick.tileId, prKey: pick.prKey })} />;
  } else if (topics.error) {
    main = <EmptyMain text={`The local API did not answer: ${topics.error.message}`} />;
  } else if (!topics.isPending && items.length === 0) {
    main = <EmptyMain text={actions.syncing ? 'Syncing your GitHub notifications…' : 'No topics yet. Sync pulls in your GitHub notifications and sorts them into topics.'} />;
  } else if (filter && !activeItem) {
    main = <EmptyMain text={`Nothing matches “${query.trim()}”. Esc clears the filter.`} />;
  } else if (topic.error) {
    main = <EmptyMain text={`Could not load the topic: ${topic.error.message}`} />;
  } else if (activeItem && topic.data) {
    main = (
      <MainPane>
        <TopicHeader detail={topic.data} group={activeItem.group} topics={items} />
        <TileGrid
          detail={topic.data}
          topics={items}
          selectedTileId={selected.view?.tile.id ?? null}
          selectedPrKey={selected.prKey}
          onSelect={pickTile}
          matchingTileIds={matchingTileIds}
        />
      </MainPane>
    );
  }

  const tellAgent = {
    available: selected.view !== null,
    tell: (draft: string) => setChatRequest({ seq: (chatRequest?.seq ?? 0) + 1, draft }),
  };

  return (
    <TellAgentContext value={tellAgent}>
      <div className="flex h-full flex-col">
        <TitleBar
          canBack={nav.canBack}
          canForward={nav.canForward}
          onBack={nav.back}
          onForward={nav.forward}
          search={<SearchField value={query} onChange={setQuery} />}
        />
        {/* Sidebar | tiles | detail. The tile column stays one tile wide and the detail
            pane takes the rest; widths hold from the 1100px minimum window up. */}
        <div className="grid min-h-0 flex-1 grid-cols-[clamp(248px,22vw,330px)_clamp(420px,33vw,480px)_minmax(0,1fr)]">
          <TopicSidebar
            topics={items}
            activeTopicId={shownTopicId}
            onSelect={(topicId) => go({ pane: 'topic', topicId, tileId: null, prKey: null })}
            inboxCount={inboxCount}
            inboxOpen={pane === 'inbox'}
            onOpenInbox={() => go({ ...shown, pane: 'inbox' })}
            instructionsOpen={pane === 'instructions'}
            onOpenInstructions={() => go({ ...shown, pane: 'instructions' })}
            notificationsOpen={pane === 'notifications'}
            onOpenNotifications={() => go({ ...shown, pane: 'notifications' })}
            loading={topics.isPending}
            error={topics.error?.message ?? null}
            filter={filter}
            onClearFilter={() => setQuery('')}
          />
          {main}
          {/* The notifications list is wide and has no tile of its own; it takes the detail pane's column too. */}
          {pane !== 'notifications' && (
            <DetailPane
              key={selected.view?.tile.id ?? 'none'}
              view={selected.view}
              prKey={selected.prKey}
              onSelectPr={(prKey) => selected.view && pickTile(selected.view.tile.id, prKey)}
              chatRequest={chatRequest}
            />
          )}
        </div>
        <StatusFooter topics={items} detail={topic.data} />
        <Toast />
      </div>
    </TellAgentContext>
  );
}
