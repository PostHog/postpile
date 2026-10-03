import { hoursBehind, laterUntil, updateAction, updateUrgency, type InstallState, type UpdateAction, type UpdateUrgency, type UpdateView } from '@postpile/core';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { queryKeys } from '../api/keys.ts';
import { useUpdate } from '../api/update.ts';
import { useNow } from './use-now.ts';

/** localStorage key for "Later": the time (epoch ms) the reminder is quiet until. */
export const SNOOZE_KEY = 'postpile.update.snoozedUntil';

function readSnooze(): number | null {
  try {
    const stored = Number(window.localStorage.getItem(SNOOZE_KEY));
    return Number.isFinite(stored) && stored > 0 ? stored : null;
  } catch {
    return null;
  }
}

// The pill (title bar) and the bar (under it) share one snooze, so "Later" in
// either one reaches the other.
let snoozedUntil: number | null | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnooze(): number | null {
  snoozedUntil ??= readSnooze();
  return snoozedUntil;
}

function snoozeUntil(time: number): void {
  snoozedUntil = time;
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(time));
  } catch {
    // Storage can be blocked; the reminder then comes back after a reload.
  }
  listeners.forEach((listener) => listener());
}

/**
 * The app's own update download, from the main process. Null on a plain web
 * page (no preload). Every change also re-reads the release check, so a
 * "Check for Updates…" from the menu shows without waiting for the next poll.
 */
function useInstallState(): InstallState | null {
  const [state, setState] = useState<InstallState | null>(null);
  const queryClient = useQueryClient();
  useEffect(() => {
    const bridge = window.postpile;
    if (!bridge?.installState || !bridge.onInstallState) {
      return;
    }
    let live = true;
    void bridge.installState().then((initial) => {
      if (live) {
        setState(initial);
      }
    });
    const stop = bridge.onInstallState((next) => {
      setState(next);
      void queryClient.invalidateQueries({ queryKey: queryKeys.update });
    });
    return () => {
      live = false;
      stop();
    };
  }, [queryClient]);
  return state;
}

export interface UpdateReminder {
  view: UpdateView | undefined;
  /** Core's answer: nothing, the small pill, or the bar. */
  urgency: UpdateUrgency;
  hoursBehind: number | null;
  /** Core's answer: offer a restart, say it is downloading, or show the brew command. */
  action: UpdateAction;
  /** "Later": quiet until the time core picks. */
  later: () => void;
  /** "Restart to update": main installs the staged update. */
  restart: () => void;
}

/** The update view plus how loud to be about it right now and what to offer (core's rules, see updateUrgency and updateAction). */
export function useUpdateReminder(): UpdateReminder {
  const view = useUpdate().data;
  const install = useInstallState();
  const snoozed = useSyncExternalStore(subscribe, getSnooze);
  const now = useNow().getTime();
  return {
    view,
    urgency: view ? updateUrgency(view, now, snoozed) : 'none',
    hoursBehind: view ? hoursBehind(view, now) : null,
    action: updateAction(install),
    later: () => {
      if (view) {
        snoozeUntil(laterUntil(view, Date.now()));
      }
    },
    restart: () => window.postpile?.restartToUpdate?.(),
  };
}
