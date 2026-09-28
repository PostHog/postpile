import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TileView } from '@postpile/core';
import { useActions } from './api/actions.tsx';
import { useAppConfig } from './api/config.ts';
import { useLivePoll } from './api/live.ts';
import { useProposals } from './api/proposals.ts';
import { useSearch } from './api/search.ts';
import { useSetupStatus } from './api/setup.ts';
import { useTools } from './api/tools.ts';
import { useTopic, useTopics } from './api/topics.ts';
import { useViewer } from './api/viewer.ts';
import { DetailPane } from './components/DetailPane.tsx';
import { InboxCleanup } from './components/InboxCleanup.tsx';
import { InboxPane } from './components/InboxPane.tsx';
import { InstructionsPane } from './components/InstructionsPane.tsx';
import { NotificationsPane } from './components/NotificationsPane.tsx';
import { PaneDivider } from './components/PaneDivider.tsx';
import { RepoScopeMenu } from './components/RepoScopeMenu.tsx';
import { SearchField } from './components/SearchField.tsx';
import { SetupFlow } from './components/SetupFlow.tsx';
import { SetupSidebar } from './components/SetupSidebar.tsx';
import { TellAgentContext, type ChatRequest } from './components/TellAgent.tsx';
import { StatusFooter } from './components/StatusFooter.tsx';
import { TileGrid } from './components/TileGrid.tsx';
import { TitleBar } from './components/TitleBar.tsx';
import { ToolsNotice } from './components/ToolsNotice.tsx';
import { Toast } from './components/Toast.tsx';
import { TopicHeader } from './components/TopicHeader.tsx';
import { TopicSidebar } from './components/TopicSidebar.tsx';
import { pinnedEntry, sameView, type NavEntry } from './lib/history.ts';
import type { SetupStepKey } from './lib/setup.ts';
import { applyQueueFilter, filterCounts, firstGridTile, type QueueFilter } from './lib/queues.ts';
import { filterTopics, searchFilter, visibleTopic } from './lib/search.ts';
import { clampPaneWidth, DETAIL_MIN_WIDTH, paneColumns, resolvedColumnWidths, type ResizablePane } from './lib/pane-widths.ts';
import { leadPr } from './lib/tiles.ts';
import { toolsNotice } from './lib/tools.ts';
import { usePaneWidths } from './lib/use-pane-widths.ts';
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
 * The tile and PR the user picked, falling back to the grid's first (shown)
 * tile and its first PR matching the search, else its lead PR.
 */
function resolveSelection(entry: NavEntry, tiles: TileView[], matchingPrKeys: Set<string> | null) {
  const view = tiles.find((candidate) => candidate.tile.id === entry.tileId) ?? firstGridTile(tiles);
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
  const live = useLivePoll();
  const viewer = useViewer();
  const config = useAppConfig();
  const setupStatus = useSetupStatus();
  const tools = useTools();
  const panes = usePaneWidths(viewer.data?.login ?? null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState('');
  // Mine / Team / Reply / Review in the sidebar. Plain UI state, not a history entry.
  const [queueFilter, setQueueFilter] = useState<QueueFilter | null>(null);
  // "Tell the agent what's wrong" from a memory line opens the selected tile's chat with a draft.
  const [chatRequest, setChatRequest] = useState<ChatRequest | null>(null);
  const search = useSearch(query);
  // The setup flow takes the middle and right panes on a first run (the server says
  // it is needed) or after "Run setup again". Once open it stays open until the user
  // finishes or closes it, even though Accept makes the server stop asking for it.
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupRerun, setSetupRerun] = useState(false);
  const [setupStep, setSetupStep] = useState<SetupStepKey>('checks');
  const setupNeeded = setupStatus.data?.needed === true;
  useEffect(() => {
    if (setupNeeded) {
      setSetupOpen(true);
    }
  }, [setupNeeded]);
  const showSetup = setupOpen || setupNeeded;
  const openSetup = () => {
    setSetupRerun(true);
    setSetupStep('checks');
    setSetupOpen(true);
  };
  const closeSetup = () => {
    setSetupOpen(false);
    setSetupRerun(false);
    setSetupStep('checks');
  };

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
  // Search and queue filter both narrow the sidebar; the open topic follows.
  const narrowed = filter !== null || queueFilter !== null;
  const shownItems = applyQueueFilter(filterTopics(items, filter), queueFilter);
  const activeItem = visibleTopic(items, nav.current.topicId, narrowed ? shownItems : null);
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
  // Write the fallbacks into the current entry, so a reorder or refetch does
  // not move the selection (and remount the detail pane, losing a chat draft)
  // or mark a topic seen the user never left. Not while a search or queue
  // filter narrows the list: that fallback is derived and goes when the
  // filter does.
  const pin = narrowed ? null : pinnedEntry(nav.current, shown);
  const pinKey = pin ? `${pin.topicId}|${pin.tileId}|${pin.prKey}` : null;
  const replaceEntry = nav.replace;
  useEffect(() => {
    if (pin) {
      replaceEntry(pin);
    }
    // pinKey stands for pin, whose object is new on every render.
  }, [pinKey]);
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

  // Sync once on app start (unless POSTPILE_SYNC_ON_START=0); after that
  // only on "Sync now". A first run skips it: setup's Accept runs the first
  // sync, once the instructions exist. The ref keeps React's dev double-mount
  // from starting a second one.
  const syncOnStart = config.data?.syncOnStart;
  const setupLoaded = setupStatus.data !== undefined || setupStatus.isError;
  // Without gh the start sync is skipped quietly: the note in the middle column says why.
  const toolsLoaded = tools.data !== undefined || tools.isError;
  const ghWorks = tools.data?.canSync !== false;
  const syncedOnStart = useRef(false);
  useEffect(() => {
    if (syncOnStart === undefined || !setupLoaded || !toolsLoaded || syncedOnStart.current) {
      return;
    }
    syncedOnStart.current = true;
    if (syncOnStart && !setupNeeded && ghWorks) {
      void actions.sync();
    }
  }, [actions, syncOnStart, setupLoaded, toolsLoaded, ghWorks, setupNeeded]);

  // A click on a Mac notification opens its tile, as a normal navigation. The
  // listener is added once and calls the latest go() through this ref.
  const latestGo = useRef(go);
  useEffect(() => {
    latestGo.current = go;
  });
  useEffect(() => {
    return window.postpile?.onOpenPing?.((target) => {
      if (target.topicId !== null) {
        latestGo.current({ pane: 'topic', topicId: target.topicId, tileId: target.tileId, prKey: target.prKey });
      }
    });
  }, []);

  let main = <EmptyMain text="Loading…" />;
  if (pane === 'inbox') {
    main = <InboxPane proposals={proposals.data} topics={items} error={proposals.error?.message ?? null} />;
  } else if (pane === 'instructions') {
    main = <InstructionsPane onOpenTopic={(topicId) => go({ pane: 'topic', topicId, tileId: null, prKey: null })} onRunSetup={openSetup} />;
  } else if (pane === 'notifications') {
    // A jump goes through go(), so back returns to this list.
    main = <NotificationsPane onOpenTile={(pick) => go({ pane: 'topic', topicId: pick.topicId, tileId: pick.tileId, prKey: pick.prKey })} />;
  } else if (topics.error) {
    main = <EmptyMain text={`The local API did not answer: ${topics.error.message}`} />;
  } else if (!topics.isPending && items.length === 0 && toolsNotice(tools.data).gh) {
    // Without gh nothing can sync: the fix is the empty state, not an error.
    main = (
      <MainPane>
        <ToolsNotice place="empty" />
      </MainPane>
    );
  } else if (!topics.isPending && items.length === 0) {
    main = (
      <MainPane>
        <InboxCleanup place="banner" />
        <p className="m-auto max-w-sm text-center text-xs leading-relaxed text-muted">
          {actions.syncing ? 'Syncing your GitHub notifications…' : 'No topics yet. Sync pulls in your GitHub notifications and sorts them into topics.'}
        </p>
      </MainPane>
    );
  } else if (filter && !activeItem) {
    main = <EmptyMain text={`Nothing matches “${query.trim()}”. Esc clears the filter.`} />;
  } else if (queueFilter && !activeItem) {
    main = <EmptyMain text="No topic has a PR that matches the filter. Click the filter again to clear it." />;
  } else if (topic.error) {
    main = <EmptyMain text={`Could not load the topic: ${topic.error.message}`} />;
  } else if (activeItem && topic.data) {
    main = (
      <MainPane>
        <ToolsNotice place="banner" />
        <InboxCleanup place="banner" />
        <TopicHeader detail={topic.data} group={activeItem.group} topics={items} />
        <TileGrid
          detail={topic.data}
          topics={items}
          selectedTileId={selected.view?.tile.id ?? null}
          selectedPrKey={selected.prKey}
          onSelect={pickTile}
          matchingTileIds={matchingTileIds}
          queueFilter={queueFilter}
        />
      </MainPane>
    );
  }

  // The grid's resolved px columns: [sidebar, tiles, detail].
  const gridColumns = () => resolvedColumnWidths(gridRef.current ? getComputedStyle(gridRef.current).gridTemplateColumns : '');
  const columnIndex: Record<ResizablePane, number> = { sidebar: 0, tiles: 1 };
  const dividerProps = (pane: ResizablePane) => ({
    startWidth: () => gridColumns()[columnIndex[pane]] ?? 0,
    clamp: (width: number) => {
      const columns = gridColumns();
      const total = columns.reduce((sum, column) => sum + column, 0);
      const other = columns[pane === 'sidebar' ? 1 : 0] ?? 0;
      return clampPaneWidth(pane, width, total - other - DETAIL_MIN_WIDTH);
    },
    onResize: (width: number) => panes.setWidth(pane, width),
    onCommit: (width: number) => panes.commit({ ...panes.widths, [pane]: width }),
    onReset: () => panes.reset(pane),
  });
  const columns = paneColumns(panes.widths);

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
          repoScope={<RepoScopeMenu />}
        />
        {/* Sidebar | tiles | detail. The tile column stays one tile wide and the detail
            pane takes the rest; widths hold from the 1100px minimum window up. The two
            dividers resize the sidebar and the tile column (kept per viewer), so the
            columns are an inline style: they are render-time values. */}
        <div ref={gridRef} className="relative grid min-h-0 flex-1" style={{ gridTemplateColumns: columns.template }}>
          {showSetup ? (
            <SetupSidebar step={setupStep} />
          ) : (
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
            shown={shownItems}
            queueFilter={queueFilter}
            onQueueFilter={setQueueFilter}
            filterCounts={filterCounts(items)}
            viewer={viewer.data}
          />
          )}
          {showSetup && (
            <SetupFlow
              rerun={setupRerun}
              step={setupStep}
              onStep={setSetupStep}
              onDone={() => {
                closeSetup();
                go({ pane: 'topic', topicId: null, tileId: null, prKey: null });
              }}
              onClose={closeSetup}
              onSkipped={() => {
                closeSetup();
                // The start sync waited for setup; skipping it means sync now, as a normal start would.
                if (syncOnStart) {
                  void actions.sync();
                }
              }}
            />
          )}
          {!showSetup && main}
          {/* The notifications list is wide and has no tile of its own; it takes the detail pane's column too. */}
          {!showSetup && pane !== 'notifications' && (
            <DetailPane
              key={selected.view?.tile.id ?? 'none'}
              view={selected.view}
              prKey={selected.prKey}
              onSelectPr={(prKey) => selected.view && pickTile(selected.view.tile.id, prKey)}
              chatRequest={chatRequest}
            />
          )}
          <PaneDivider label="Resize the sidebar" left={columns.sidebar} {...dividerProps('sidebar')} />
          {/* The notifications list spans both right columns, so there is no tile edge to drag. */}
          {!showSetup && pane !== 'notifications' && <PaneDivider label="Resize the tile column" left={`calc(${columns.sidebar} + ${columns.tiles})`} {...dividerProps('tiles')} />}
        </div>
        <StatusFooter topics={items} detail={topic.data} live={live.data} />
        <Toast />
      </div>
    </TellAgentContext>
  );
}
