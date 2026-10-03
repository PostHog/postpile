import { useEffect, useState } from 'react';
import { useInboxCleanup } from '../api/cleanup.ts';
import { InboxCleanupDialog } from './InboxCleanupDialog.tsx';

/**
 * The inbox cleanup dialog on start: shows while the server holds the start
 * sync for it (`view.start`, one of the cases), before any agent work runs.
 * Mounted once in App. Answered, it closes at once; the server stops asking
 * as soon as it has the answer.
 */
export function InboxStartDialog() {
  const view = useInboxCleanup().data;
  const start = view?.start ?? null;
  const [answered, setAnswered] = useState(false);
  // Once the server stopped asking, a later start (the next long gap) may ask again.
  useEffect(() => {
    if (start === null) {
      setAnswered(false);
    }
  }, [start]);
  if (!view || start === null || answered) {
    return null;
  }
  return <InboxCleanupDialog mode={start} view={view} onClose={() => setAnswered(true)} />;
}
