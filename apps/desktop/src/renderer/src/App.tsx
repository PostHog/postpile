import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useActions } from './api/actions.tsx';
import { useAppConfig } from './api/config.ts';
import { useLivePoll } from './api/live.ts';
import { useProposals } from './api/proposals.ts';
import { useSearch } from './api/search.ts';
import { useSetupStatus } from './api/setup.ts';
import { sendTelemetry } from './api/telemetry.ts';
import { useTools } from './api/tools.ts';
import { useFinishedTopics, useTopic, useTopics } from './api/topics.ts';
import { useViewer } from './api/viewer.ts';
import { DetailPane } from './components/DetailPane.tsx';
import { InboxCleanup } from './components/InboxCleanup.tsx';
import { InboxPane } from './components/InboxPane.tsx';
import { InstructionsPane } from './components/InstructionsPane.tsx';
import { NotificationsPane } from './components/NotificationsPane.tsx';
import { HandledQuietlyPane } from './components/HandledQuietlyPane.tsx';
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
import { applyQueueFilter, filterCounts, type QueueFilter } from './lib/queues.ts';
import { filterTopics, searchFilter, visibleTopic } from './lib/search.ts';
import { filterKey, keptFor, listedTopics, nextKept, noSelectionText, resolveSelection, withSelectedTile, type KeptView, type TileFilter } from './lib/selection.ts';
import { clampPaneWidth, DETAIL_MIN_WIDTH, paneColumns, resolvedColumnWidths, type ResizablePane } from './lib/pane-widths.ts';
import { tileOpenedProps } from './lib/tile-telemetry.ts';
import { toolsNotice } from './lib/tools.ts';
import { topicTelemetrySection } from './lib/topic-section.ts';
import { usePaneWidths } from './lib/use-pane-widths.ts';
import { useNavHistory, useNavShortcuts } from './lib/use-nav-history.ts';
import { useOpenedRead } from './lib/use-opened-read.ts';

function entryKey(entry: NavEntry): string {
  return `${entry.pane}|${entry.topicId}|${entry.tileId}|${entry.prKey}`;
}

function MainPane(props: { children: ReactNode }) {
  return <main className="flex min-w-0 flex-col gap-4 overflow-auto px-[26px] pt-5 pb-[22px]">{props.children}</main>;
}

function EmptyMain(props: { text: string }) {
  return (
    <MainPane>
      <p className="m-auto max-w-sm text-center text-xs leading-relaxed text-muted">{props.text}</p>
    </MainPane>
  );
}

export function App() {
  const actions = useActions();
  const topics = useTopics();
  const finished = useFinishedTopics();
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
  const [tileFilter, setTileFilter] = useState<TileFilter>('all');
  // Switching the grid to Unread clears the selection in the open topic (until the next pick or topic change).
  // Kept apart from the nav entry, so a shown fallback topic never rewrites the user's hidden pick.
  const [deselected, setDeselected] = useState<{ topicId: string; entryKey: string } | null>(null);
  const [queueFilter, setQueueFilter] = useState<QueueFilter | null>(null);
  const changeQueueFilter = (filter: QueueFilter | null): void => {
    setQueueFilter(filter);
    sendTelemetry('queue_filter_changed', { filter: filter ?? 'none' });
  };
  // "Tell the agent what's wrong" from a memory line opens the selected tile's chat with a draft.
  const [chatRequest, setChatRequest] = useState<ChatRequest | null>(null);
  const search = useSearch(query);
  // The setup flow takes the middle and right panes on a first run (the server says
  // it is needed) or after "Run setup again". Once open it stays open until the user
  // finishes or closes it, even though Accept makes the server stop asking for it.
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupRerun, setSetupRerun] = useState(false);
  const [setupStep, setSetupStepState] = useState<SetupStepKey>('checks');
  const setSetupStep = (step: SetupStepKey): void => {
    setSetupStepState(step);
    sendTelemetry('setup_step_viewed', { step });
  };
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
  const finishedIds = new Set((finished.data ?? []).map((entry) => entry.id));
  // Navigation is a back / forward history; the current entry is what the user picked.
  const nav = useNavHistory(new Set([...items.map((item) => item.topic.id), ...finishedIds]));
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
  // What was on screen for this pick and these filters. An approve, refetch,
  // poll or sync that drops it from the filter keeps it on screen; only a new
  // pick or a filter change lets the "first match" fallback move the view.
  const [kept, setKept] = useState<KeptView | null>(null);
  const currentFilterKey = filterKey(queueFilter, filter ? (search.data?.query ?? null) : null);
  const keptNow = keptFor(kept, nav.current, currentFilterKey);
  // A topic picked in the Finished drawer is not in the list, so it opens by id.
  // Search and the queue filters cover live topics only: while they narrow, their first match shows.
  const pickedFinishedId = nav.current.topicId !== null && finishedIds.has(nav.current.topicId) ? nav.current.topicId : null;
  const finishedId = narrowed ? null : pickedFinishedId;
  const activeItem = finishedId === null ? visibleTopic(items, nav.current.topicId, narrowed ? shownItems : null, keptNow?.topicId ?? null) : null;
  const activeTopicId = finishedId ?? activeItem?.topic.id ?? null;
  const topic = useTopic(activeTopicId);
  const matchingTileIds = activeItem && filter ? (filter.tilesByTopic.get(activeItem.topic.id) ?? new Set<string>()) : null;
  const allTiles = topic.data?.tiles ?? [];
  const shownTiles = allTiles.filter((view) => !matchingTileIds || matchingTileIds.has(view.tile.id));
  const keptTile = keptNow && keptNow.topicId === activeTopicId ? keptNow : null;
  const noTile = deselected !== null && deselected.topicId === activeTopicId && deselected.entryKey === entryKey(nav.current);
  const selected = resolveSelection(nav.current, shownTiles, allTiles, filter?.prKeys ?? null, keptTile, tileFilter, noTile);
  // What is on screen after the fallbacks. Picking it again adds no history entry.
  const shown: NavEntry = { pane, topicId: activeTopicId, tileId: selected.view?.tile.id ?? null, prKey: selected.prKey };
  const keptAfter = nextKept(kept, currentFilterKey, nav.current, shown, selected.auto && selected.view ? { tileFilter, state: selected.view.state.kind } : null);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs after every render on purpose; setKept is guarded by the comparison
  useEffect(() => {
    if (keptAfter !== kept) {
      setKept(keptAfter);
    }
  });
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
  // An app-picked tile is not pinned: pinning would make it the user's pick.
  const pin = narrowed ? null : pinnedEntry(nav.current, selected.auto ? { ...shown, tileId: null, prKey: null } : shown);
  const pinKey = pin ? `${pin.topicId}|${pin.tileId}|${pin.prKey}` : null;
  const replaceEntry = nav.replace;
  useEffect(() => {
    if (pin) {
      replaceEntry(pin);
    }
    // pinKey stands for pin, whose object is new on every render.
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- pinKey stands for pin, replaceEntry changes every render
  }, [pinKey]);
  const changeTileFilter = (next: TileFilter): void => {
    setTileFilter(next);
    if (next === 'unread' && tileFilter !== 'unread' && activeTopicId !== null) {
      setDeselected({ topicId: activeTopicId, entryKey: entryKey(nav.current) });
    }
  };
  useEffect(() => {
    setDeselected(null);
  }, [activeTopicId]);
  const pickTile = (tileId: string, prKey: string) => {
    const view = topic.data?.tiles.find((candidate) => candidate.tile.id === tileId);
    if (view) {
      sendTelemetry('tile_opened', tileOpenedProps(view));
    }
    go({ pane: 'topic', topicId: activeTopicId, tileId, prKey });
  };
  const inboxCount = (proposals.data?.topics.length ?? 0) + (proposals.data?.rules.length ?? 0);

  // A topic counts as seen when the user leaves it: picks another topic, the
  // Inbox or their instructions. Simpler than a visibility timer, and the
  // "since you last looked" block stays put while they are still reading it.
  // This follows the picked topic, not the shown one, so a search filter that
  // hides the topic for a moment does not mark it seen.
  const shownTopicId = pane === 'topic' ? activeTopicId : null;
  const pickedTopicId = pane === 'topic' ? (pickedFinishedId ?? visibleTopic(items, nav.current.topicId, null, null)?.topic.id ?? null) : null;
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
  } else if (pane === 'quiet') {
    main = <HandledQuietlyPane onOpenTile={(pick) => go({ pane: 'topic', topicId: pick.topicId, tileId: pick.tileId, prKey: pick.prKey })} />;
  } else if (topics.error) {
    main = <EmptyMain text={`The local API did not answer: ${topics.error.message}`} />;
  } else if (!topics.isPending && items.length === 0 && finishedId === null && toolsNotice(tools.data).gh) {
    // Without gh nothing can sync: the fix is the empty state, not an error.
    main = (
      <MainPane>
        <ToolsNotice place="empty" />
      </MainPane>
    );
  } else if (!topics.isPending && items.length === 0 && finishedId === null) {
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
  } else if (activeTopicId && topic.data) {
    main = (
      <MainPane>
        <ToolsNotice place="banner" />
        <InboxCleanup place="banner" />
        <TopicHeader detail={topic.data} group={activeItem?.group ?? 'quiet'} topics={items} />
        <TileGrid
          detail={topic.data}
          topics={items}
          selectedTileId={selected.view?.tile.id ?? null}
          selectedPrKey={selected.prKey}
          onSelect={pickTile}
          selectedIsAuto={selected.auto}
          filter={tileFilter}
          onFilter={changeTileFilter}
          matchingTileIds={withSelectedTile(matchingTileIds, selected.auto ? null : (selected.view?.tile.id ?? null))}
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
  const wideList = pane === 'notifications' || pane === 'quiet';
  // A PR open in the detail pane counts like a visit on github.com when nothing is asked of the user (DESIGN "You already dealt with it").
  const detailShown = !showSetup && !wideList;
  useOpenedRead(detailShown ? selected.view : null, detailShown ? selected.prKey : null);

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
        {/* Sidebar | tiles | detail. The tile column stays one tile wide; by default it and
            the detail pane split what the sidebar leaves evenly, from the 1100px minimum
            window up. The two
            dividers resize the sidebar and the tile column (kept per viewer), so the
            columns are an inline style: they are render-time values. */}
        <div ref={gridRef} className="relative grid min-h-0 flex-1" style={{ gridTemplateColumns: columns.template }}>
          {showSetup ? (
            <SetupSidebar step={setupStep} />
          ) : (
          <TopicSidebar
            topics={items}
            activeTopicId={shownTopicId}
            selectedTileId={pane === 'topic' ? (selected.view?.tile.id ?? null) : null}
            onSelect={(topicId) => {
              const item = items.find((candidate) => candidate.topic.id === topicId);
              if (item) {
                sendTelemetry('topic_opened', { section: topicTelemetrySection(item.queues) });
              }
              go({ pane: 'topic', topicId, tileId: null, prKey: null });
            }}
            inboxCount={inboxCount}
            inboxOpen={pane === 'inbox'}
            onOpenInbox={() => go({ ...shown, pane: 'inbox' })}
            instructionsOpen={pane === 'instructions'}
            onOpenInstructions={() => go({ ...shown, pane: 'instructions' })}
            notificationsOpen={pane === 'notifications'}
            onOpenNotifications={() => go({ ...shown, pane: 'notifications' })}
            quietOpen={pane === 'quiet'}
            onOpenQuiet={() => go({ ...shown, pane: 'quiet' })}
            loading={topics.isPending}
            error={topics.error?.message ?? null}
            filter={filter}
            onClearFilter={() => setQuery('')}
            shown={listedTopics(items, shownItems, activeTopicId)}
            queueFilter={queueFilter}
            onQueueFilter={changeQueueFilter}
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
          {/* The notifications and Handled quietly lists are wide and have no tile of their own; they take the detail pane's column too. */}
          {!showSetup && !wideList && (
            <DetailPane
              key={selected.view?.tile.id ?? 'none'}
              view={selected.view}
              prKey={selected.prKey}
              onSelectPr={(prKey) => selected.view && pickTile(selected.view.tile.id, prKey)}
              chatRequest={chatRequest}
              noSelectionText={noSelectionText(tileFilter)}
            />
          )}
          <PaneDivider label="Resize the sidebar" left={columns.sidebar} {...dividerProps('sidebar')} />
          {/* The wide lists span both right columns, so there is no tile edge to drag. */}
          {!showSetup && !wideList && <PaneDivider label="Resize the tile column" left={`calc(${columns.sidebar} + ${columns.tiles})`} {...dividerProps('tiles')} />}
        </div>
        <StatusFooter topics={items} detail={topic.data} live={live.data} />
        <Toast />
      </div>
    </TellAgentContext>
  );
}
