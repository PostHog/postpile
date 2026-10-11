import { useState } from 'react';
import { keptTopicIds, nextKeptHolds, placeHold, type SidebarHold } from './sidebar-hold.ts';

/**
 * The hold the sidebar applies (`nextKeptHolds`, `placeHold`): the current
 * selection's, or the rows it left while the pointer stays over the
 * sidebar. Attach `onPointerEnter` and `onPointerLeave` to the sidebar;
 * leaving releases the kept rows. Only UI state.
 */
export function useSidebarHold(current: SidebarHold) {
  const [inside, setInside] = useState(false);
  const [last, setLast] = useState<SidebarHold>(current);
  const [kept, setKept] = useState<SidebarHold[]>([]);
  if (last.key !== current.key || last.topicId !== current.topicId) {
    // The documented "adjust state while rendering" pattern: React re-renders right away with it.
    setLast(current);
    setKept(nextKeptHolds(kept, last, current, inside));
  }
  return {
    hold: placeHold(current, kept),
    keptIds: keptTopicIds(current, kept),
    onPointerEnter: () => setInside(true),
    onPointerLeave: () => {
      setInside(false);
      setKept([]);
    },
  };
}
