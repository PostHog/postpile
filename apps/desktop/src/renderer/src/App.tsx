import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TopicDetail } from '@code-manager/core';
import { useActions } from './api/actions.tsx';
import { useProposals } from './api/proposals.ts';
import { useTopic, useTopics } from './api/topics.ts';
import { DetailPane } from './components/DetailPane.tsx';
import { InboxPane } from './components/InboxPane.tsx';
import { InstructionsPane } from './components/InstructionsPane.tsx';
import { StatusFooter } from './components/StatusFooter.tsx';
import { TileGrid } from './components/TileGrid.tsx';
import { TitleBar } from './components/TitleBar.tsx';
import { Toast } from './components/Toast.tsx';
import { TopicHeader } from './components/TopicHeader.tsx';
import { TopicSidebar } from './components/TopicSidebar.tsx';
import { leadPr } from './lib/tiles.ts';

/** What the middle pane shows. */
type Pane = 'topic' | 'inbox' | 'instructions';

interface TileSelection {
  tileId: string;
  prKey: string;
}

function MainPane(props: { children: ReactNode }) {
  return <main className="flex min-w-0 flex-col gap-[18px] overflow-auto px-[26px] py-[22px]">{props.children}</main>;
}

function EmptyMain(props: { text: string }) {
  return (
    <MainPane>
      <p className="m-auto max-w-sm text-center text-xs leading-relaxed text-muted">{props.text}</p>
    </MainPane>
  );
}

/** The tile and PR the user picked, falling back to the first tile and its lead PR. */
function resolveSelection(selection: TileSelection | null, detail: TopicDetail | undefined) {
  const tiles = detail?.tiles ?? [];
  const view = tiles.find((candidate) => candidate.tile.id === selection?.tileId) ?? tiles[0] ?? null;
  let prKey: string | null = null;
  if (view) {
    const picked = view.prs.find((pr) => pr.key === selection?.prKey);
    prKey = picked?.key ?? leadPr(view)?.key ?? null;
  }
  return { view, prKey };
}

export function App() {
  const actions = useActions();
  const topics = useTopics();
  const [pickedTopicId, setPickedTopicId] = useState<string | null>(null);
  const [pickedTile, setPickedTile] = useState<TileSelection | null>(null);
  const [pane, setPane] = useState<Pane>('topic');
  const proposals = useProposals();

  const items = topics.data ?? [];
  const activeItem = items.find((item) => item.topic.id === pickedTopicId) ?? items[0] ?? null;
  const topic = useTopic(activeItem?.topic.id ?? null);
  const selected = resolveSelection(pickedTile, topic.data);
  const inboxCount = (proposals.data?.topics.length ?? 0) + (proposals.data?.rules.length ?? 0);

  // A topic counts as seen when the user leaves it: picks another topic, the
  // Inbox or their instructions. Simpler than a visibility timer, and the
  // "since you last looked" block stays put while they are still reading it.
  const shownTopicId = pane === 'topic' ? (activeItem?.topic.id ?? null) : null;
  const lastShownTopicId = useRef<string | null>(null);
  useEffect(() => {
    const left = lastShownTopicId.current;
    lastShownTopicId.current = shownTopicId;
    if (left !== null && left !== shownTopicId) {
      void actions.markTopicSeen(left);
    }
  }, [shownTopicId, actions]);

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
  } else if (topics.error) {
    main = <EmptyMain text={`The local API did not answer: ${topics.error.message}`} />;
  } else if (!topics.isPending && items.length === 0) {
    main = <EmptyMain text={actions.syncing ? 'Syncing your GitHub notifications…' : 'No topics yet. Sync pulls in your GitHub notifications and sorts them into topics.'} />;
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
          onSelect={(tileId, prKey) => setPickedTile({ tileId, prKey })}
        />
      </MainPane>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <div className="grid min-h-0 flex-1 grid-cols-[264px_minmax(0,1fr)_404px]">
        <TopicSidebar
          topics={items}
          activeTopicId={shownTopicId}
          onSelect={(topicId) => {
            setPane('topic');
            setPickedTopicId(topicId);
          }}
          inboxCount={inboxCount}
          inboxOpen={pane === 'inbox'}
          onOpenInbox={() => setPane('inbox')}
          instructionsOpen={pane === 'instructions'}
          onOpenInstructions={() => setPane('instructions')}
          loading={topics.isPending}
          error={topics.error?.message ?? null}
        />
        {main}
        <DetailPane
          key={selected.view?.tile.id ?? 'none'}
          view={selected.view}
          prKey={selected.prKey}
          onSelectPr={(prKey) => selected.view && setPickedTile({ tileId: selected.view.tile.id, prKey })}
        />
      </div>
      <StatusFooter topics={items} detail={topic.data} />
      <Toast />
    </div>
  );
}
