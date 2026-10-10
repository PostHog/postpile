import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PingTarget } from '@postpile/core';
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
import { AgentPane } from './components/AgentPane.tsx';
import { DetailPane } from './components/DetailPane.tsx';
import { InboxStartDialog } from './components/InboxStartDialog.tsx';
import { InboxPane } from './components/InboxPane.tsx';
import { InstructionsPane } from './components/InstructionsPane.tsx';
import { InterruptionsPrompt } from './components/InterruptionsPrompt.tsx';
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
import { UpdateBar } from './components/UpdateBar.tsx';
import { ToolsNotice } from './components/ToolsNotice.tsx';
import { Toast } from './components/Toast.tsx';
import { TidyOverlay } from './components/TidyOverlay.tsx';
import { TopicHeader } from './components/TopicHeader.tsx';
import { TopicSidebar } from './components/TopicSidebar.tsx';
import { pinnedEntry, sameView, type NavEntry } from './lib/history.ts';
import type { SetupStepKey } from './lib/setup.ts';
import { applyQueueFilter, filterCounts, type QueueFilter } from './lib/queues.ts';
import { filterTopics, searchFilter, visibleTopic } from './lib/search.ts';
import { dwellPrKey, filterKey, keptFor, listedTopics, nextKept, resolveSelection, revealedFor, withSelectedTile, type KeptView } from './lib/selection.ts';
import { clampPaneWidth, DETAIL_MIN_WIDTH, paneColumns, resolvedColumnWidths, type ResizablePane } from './lib/pane-widths.ts';
import { tileOpenedProps } from './lib/tile-telemetry.ts';
import { prNumber } from './lib/tiles.ts';
import { toolsNotice } from './lib/tools.ts';
import { usePaneWidths } from './lib/use-pane-widths.ts';
import { useNavHistory, useNavShortcuts } from './lib/use-nav-history.ts';
import { OpenedReadContext, useOpenedRead } from './lib/use-opened-read.ts';
import { useTileVisit } from './lib/use-tile-visit.ts';

function MainPane(props: { children: ReactNode }) {
  return <main className="pane-scroll flex min-w-0 flex-col gap-4 overflow-auto pl-[26px] pr-[16px] pt-5 pb-[22px]">{props.children}</main>;
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
  const [queueFilter, setQueueFilter] = useState<QueueFilter | null>(null);
  // The grid's Dealt with group: the user's last click on it (open or closed), kept for the session in every topic. Starts folded.
  const [dealtWithOpen, setDealtWithOpen] = useState(false);
  const changeQueueFilter = (filter: QueueFilter | null): void => {
    setQueueFilter(filter);
    sendTelemetry('queue_filter_changed', { filter: filter ?? 'none' });
  };
  // "Ask the agent" on the topic header, or "Tell the agent" from a glance or a memory line: the topic's agent takes the right pane.
  const [agentRequest, setAgentRequest] = useState<ChatRequest | null>(null);
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
  // The PR the user picked with their last navigation (a tile or PR click, a ping click, a jump from a
  // list), else null. Only that one arms the open-read dwell; a tile the app picked never does (2026-10-10).
  const [userPick, setUserPick] = useState<string | null>(null);
  // Back and forward pick another entry like any pick: the agent pane closes first, as in go().
  // They are not a fresh pick of a PR, so they arm no dwell.
  const back = () => {
    setAgentRequest(null);
    setUserPick(null);
    nav.back();
  };
  const forward = () => {
    setAgentRequest(null);
    setUserPick(null);
    nav.forward();
  };
  useNavShortcuts(back, forward);
  const pane = nav.current.pane;
  // A blank query filters nothing, even while react-query still holds the last answer.
  const filter = searchFilter(query.trim() === '' ? undefined : search.data);
  // When the filter hides the picked topic, the first match shows instead. That is
  // derived, not a navigation: history stays clean and clearing the filter
  // brings the picked topic back.
  // Search and queue filter both narrow the sidebar; the open topic follows.
  const narrowed = filter !== null || queueFilter !== null;
  const searched = filterTopics(items, filter);
  const shownItems = applyQueueFilter(searched, queueFilter);
  // What was on screen for this pick and these filters. An approve, refetch,
  // poll or sync that drops it from the filter keeps it on screen; only a new
  // pick or a filter change lets the "first match" fallback move the view.
  const [kept, setKept] = useState<KeptView | null>(null);
  const currentFilterKey = filterKey(queueFilter, filter ? (search.data?.query ?? null) : null);
  const keptNow = keptFor(kept, nav.current, currentFilterKey);
  // A click on a Mac ping shows its tile even while the search, the queue
  // filter or the repo scope hides its topic, and leaves them as they are
  // (2026-10-01). It holds while the user stays in that topic under the same filters.
  const [revealed, setRevealed] = useState<KeptView | null>(null);
  const revealedNow = revealedFor(revealed, nav.current, currentFilterKey);
  // A topic picked in the Archive drawer is not in the list, so it opens by id.
  // Search and the queue filters cover live topics only: while they narrow, their first match shows.
  // A revealed topic the list does not hold (another repo, finished) opens by id the same way.
  const pickedFinishedId = nav.current.topicId !== null && finishedIds.has(nav.current.topicId) ? nav.current.topicId : null;
  const revealedUnlistedId = revealedNow && !items.some((item) => item.topic.id === revealedNow.topicId) ? revealedNow.topicId : null;
  const finishedId = revealedUnlistedId ?? (narrowed ? null : pickedFinishedId);
  const activeItem =
    finishedId === null ? visibleTopic(items, nav.current.topicId, narrowed ? shownItems : null, revealedNow?.topicId ?? keptNow?.topicId ?? null) : null;
  const activeTopicId = finishedId ?? activeItem?.topic.id ?? null;
  const sidebarTopics = listedTopics(items, shownItems, activeTopicId);
  // A topic kept on screen after it stopped matching is listed, so it does not count as hidden.
  const hiddenByQueueFilter = searched.filter((item) => !sidebarTopics.includes(item)).length;
  const topic = useTopic(activeTopicId);
  // The agent pane shows for the topic on screen only; picking anything else hands the pane back (`go`).
  const agentShown = pane === 'topic' && agentRequest !== null && agentRequest.topicId === activeTopicId;
  const openAgent = (topicId: string, draft: string) => setAgentRequest({ seq: Date.now(), topicId, draft });
  const matchingTileIds = activeItem && filter ? (filter.tilesByTopic.get(activeItem.topic.id) ?? new Set<string>()) : null;
  const allTiles = topic.data?.tiles ?? [];
  const shownTiles = allTiles.filter((view) => !matchingTileIds || matchingTileIds.has(view.tile.id));
  // The kept view once there is one for this pick; right after a ping click, the revealed tile.
  const keptTile = [keptNow, revealedNow].find((view) => view && view.topicId === activeTopicId) ?? null;
  const selected = resolveSelection(nav.current, shownTiles, allTiles, filter?.prKeys ?? null, keptTile);
  // What is on screen after the fallbacks. Picking it again adds no history entry.
  const shown: NavEntry = { pane, topicId: activeTopicId, tileId: selected.view?.tile.id ?? null, prKey: selected.prKey };
  const keptAfter = nextKept(kept, currentFilterKey, nav.current, shown, selected.auto && selected.view ? { group: selected.view.group } : null);
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- runs after every render on purpose; setKept is guarded by the comparison
  useEffect(() => {
    if (keptAfter !== kept) {
      setKept(keptAfter);
    }
  });
  const go = (next: NavEntry) => {
    // Any pick hands the right pane back to the PR.
    setAgentRequest(null);
    // A navigation is not a pick of a PR; openByUser sets it again right after.
    setUserPick(null);
    if (!sameView(shown, next)) {
      nav.navigate(next);
    } else if (selected.auto && next.pane === 'topic' && next.tileId !== null) {
      // Picking the tile the app picked makes it the user's pick, without a new history entry.
      nav.replace(next);
    }
  };
  // Grows with every explicit open (a tile click, a ping click), so opening the tile already open counts as a visit again.
  const [visits, setVisits] = useState(0);
  // The user opened this tile and PR themselves: go there, and let the dwell count it.
  const openByUser = (next: NavEntry) => {
    go(next);
    setUserPick(next.prKey);
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
  const pickTile = (tileId: string, prKey: string) => {
    const view = topic.data?.tiles.find((candidate) => candidate.tile.id === tileId);
    if (view) {
      sendTelemetry('tile_opened', tileOpenedProps(view));
    }
    openByUser({ pane: 'topic', topicId: activeTopicId, tileId, prKey });
    setVisits((count) => count + 1);
  };
  const inboxCount = (proposals.data?.topics.length ?? 0) + (proposals.data?.rules.length ?? 0);

  // A topic counts as seen when the user leaves it: picks another topic, the
  // Inbox or their instructions. Simpler than a visibility timer, and the
  // "since you last looked" block stays put while they are still reading it.
  // This follows the picked topic, not the shown one, so a search filter that
  // hides the topic for a moment does not mark it seen.
  const shownTopicId = pane === 'topic' ? activeTopicId : null;
  const pickedTopicId = pane === 'topic' ? (revealedUnlistedId ?? pickedFinishedId ?? visibleTopic(items, nav.current.topicId, null, null)?.topic.id ?? null) : null;
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

  // A click on a Mac notification opens its tile, as a normal navigation, and
  // reveals it past the filters (`revealed`). Main looked the target up at the
  // click. The listener is added once and calls the latest openPing through this ref.
  const openPing = (target: PingTarget) => {
    if (target.topicId === null) {
      return;
    }
    const entry: NavEntry = { pane: 'topic', topicId: target.topicId, tileId: target.tileId, prKey: target.prKey };
    openByUser(entry);
    setRevealed({ filterKey: currentFilterKey, entry, topicId: target.topicId, tileId: target.tileId, prKey: target.prKey });
    setVisits((count) => count + 1);
  };
  const latestOpenPing = useRef(openPing);
  useEffect(() => {
    latestOpenPing.current = openPing;
  });
  useEffect(() => {
    return window.postpile?.onOpenPing?.((target) => latestOpenPing.current(target));
  }, []);

  let main = <EmptyMain text="Loading…" />;
  if (pane === 'inbox') {
    main = <InboxPane proposals={proposals.data} topics={items} error={proposals.error?.message ?? null} />;
  } else if (pane === 'instructions') {
    main = <InstructionsPane onOpenTopic={(topicId) => go({ pane: 'topic', topicId, tileId: null, prKey: null })} onRunSetup={openSetup} />;
  } else if (pane === 'notifications') {
    // A jump goes through go(), so back returns to this list.
    main = <NotificationsPane onOpenTile={(pick) => openByUser({ pane: 'topic', topicId: pick.topicId, tileId: pick.tileId, prKey: pick.prKey })} />;
  } else if (pane === 'quiet') {
    main = <HandledQuietlyPane onOpenTile={(pick) => openByUser({ pane: 'topic', topicId: pick.topicId, tileId: pick.tileId, prKey: pick.prKey })} />;
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
        <p className="m-auto max-w-sm text-center text-xs leading-relaxed text-muted">
          {actions.syncing ? 'Syncing your GitHub notifications…' : 'No topics yet. Sync pulls in your GitHub notifications and sorts them into topics.'}
        </p>
      </MainPane>
    );
  } else if (filter && !activeItem && revealedUnlistedId === null) {
    main = <EmptyMain text={`Nothing matches “${query.trim()}”. Esc clears the filter.`} />;
  } else if (queueFilter && !activeItem && revealedUnlistedId === null) {
    main = <EmptyMain text="No topic has a PR that matches the filter. Pick “any PR” to show all topics." />;
  } else if (topic.error) {
    main = <EmptyMain text={`Could not load the topic: ${topic.error.message}`} />;
  } else if (activeTopicId && topic.data) {
    main = (
      <MainPane>
        <ToolsNotice place="banner" />
        <TopicHeader
          detail={topic.data}
          topics={items}
          agentOpen={agentShown}
          onAskAgent={() => (agentShown ? setAgentRequest(null) : openAgent(topic.data!.topic.id, ''))}
        />
        <TileGrid
          detail={topic.data}
          topics={items}
          selectedTileId={selected.view?.tile.id ?? null}
          selectedPrKey={selected.prKey}
          onSelect={pickTile}
          dealtWithOpen={dealtWithOpen}
          onDealtWithOpen={setDealtWithOpen}
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
  const detailShown = !showSetup && !wideList && !agentShown;
  const openedRead = useOpenedRead(detailShown ? selected.view : null, detailShown ? dwellPrKey(selected, userPick) : null);
  // The user's pick clears its Mac pings from Notification Center; a tile the app picked does not.
  useTileVisit(detailShown && !selected.auto ? selected.view : null, visits);

  const tellAgent = {
    available: selected.view !== null,
    tell: (draft: string) => {
      if (selected.view) {
        openAgent(selected.view.tile.topicId, draft);
      }
    },
  };
  const backLabel = selected.prKey ? `Back to #${prNumber(selected.prKey)}` : 'Back';

  return (
    <TellAgentContext value={tellAgent}>
      <OpenedReadContext value={openedRead}>
        <div className="flex h-full flex-col">
          <TitleBar
            canBack={nav.canBack}
            canForward={nav.canForward}
            onBack={back}
            onForward={forward}
            search={<SearchField value={query} onChange={setQuery} />}
            repoScope={<RepoScopeMenu />}
          />
          <UpdateBar />
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
                  sendTelemetry('topic_opened', { section: item.section });
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
              shown={sidebarTopics}
              queueFilter={queueFilter}
              hiddenByQueueFilter={hiddenByQueueFilter}
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
            {!showSetup && !wideList && agentShown && agentRequest && (
              <AgentPane
                key={agentRequest.seq}
                topicId={agentRequest.topicId}
                topicName={topic.data?.topic.name ?? ''}
                draft={agentRequest.draft}
                backLabel={backLabel}
                onBack={() => setAgentRequest(null)}
              />
            )}
            {!showSetup && !wideList && !agentShown && (
              <DetailPane
                key={selected.view?.tile.id ?? 'none'}
                view={selected.view}
                prKey={selected.prKey}
                onSelectPr={(prKey) => selected.view && pickTile(selected.view.tile.id, prKey)}
                noSelectionText="Pick a tile to see it."
              />
            )}
            <PaneDivider label="Resize the sidebar" left={columns.sidebar} {...dividerProps('sidebar')} />
            {/* The wide lists span both right columns, so there is no tile edge to drag. */}
            {!showSetup && !wideList && <PaneDivider label="Resize the tile column" left={`calc(${columns.sidebar} + ${columns.tiles})`} {...dividerProps('tiles')} />}
          </div>
          <StatusFooter topics={items} detail={topic.data} live={live.data} />
          <Toast onShowActionLog={() => go({ ...shown, pane: 'notifications' })} />
          <InboxStartDialog />
          {/* Installs that never picked an interruptions mode get asked once, never on top of setup. */}
          <InterruptionsPrompt blocked={showSetup || !setupLoaded} />
          <TidyOverlay />
        </div>
      </OpenedReadContext>
    </TellAgentContext>
  );
}
