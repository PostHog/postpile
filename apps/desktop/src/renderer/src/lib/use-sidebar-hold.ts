import { useState } from 'react';
import { heldRows, keptTopicIds, nextKeptHolds, type SidebarHold } from './sidebar-hold.ts';

/**
 * What the sidebar holds (`nextKeptHolds`, `heldRows`): the current
 * selection's row and the rows it left while the pointer stays over the
 * sidebar. Attach `onPointerEnter` and `onPointerLeave` to the sidebar;
 * leaving releases the kept rows. Only UI state.
 */
export function useSidebarHold(current: SidebarHold) {
  const [inside, setInside] = useState(false);
  const [last, setLast] = useState<SidebarHold>(current);
  const [kept, setKept] = useState<SidebarHold[]>([]);
  const changed = last.key !== current.key || last.topicId !== current.topicId;
  // Worked out in this render too, so the hooks after this one already see the row just left.
  const nextKept = changed ? nextKeptHolds(kept, last, current, inside) : kept;
  if (changed) {
    // The documented "adjust state while rendering" pattern: React re-renders right away with it.
    setLast(current);
    setKept(nextKept);
  }
  return {
    rows: heldRows(current, nextKept),
    keptIds: keptTopicIds(current, nextKept),
    onPointerEnter: () => setInside(true),
    onPointerLeave: () => {
      setInside(false);
      setKept([]);
    },
  };
}
