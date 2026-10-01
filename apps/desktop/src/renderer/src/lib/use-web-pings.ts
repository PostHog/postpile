import { useCallback, useEffect, useRef, useState } from 'react';
import type { PingTarget } from '@postpile/core';
import { fetchPingTarget, usePingFeed } from '../api/pings.ts';
import { browserPermission, isWebPage, webPinger, type WebPingPermission } from './web-pings.ts';

export function useWebPings(openPing: (target: PingTarget) => void): void {
  const feed = usePingFeed(isWebPage());
  const latestOpenPing = useRef(openPing);
  useEffect(() => {
    latestOpenPing.current = openPing;
  });
  useEffect(() => {
    const pings = feed.data?.pings ?? [];
    webPinger.show(pings, (ping) => {
      window.focus();
      fetchPingTarget(ping.id)
        .then((target) => {
          if (target) {
            latestOpenPing.current(target);
          }
        })
        .catch((error: unknown) => console.warn('ping click:', error));
    });
  }, [feed.data]);
}

export function useNotificationPermission(): WebPingPermission {
  const [permission, setPermission] = useState(browserPermission);
  const refresh = useCallback(() => setPermission(browserPermission()), []);
  useEffect(() => {
    let status: PermissionStatus | null = null;
    navigator.permissions
      ?.query({ name: 'notifications' })
      .then((result) => {
        status = result;
        result.onchange = refresh;
      })
      .catch(() => {});
    window.addEventListener('focus', refresh);
    return () => {
      if (status) {
        status.onchange = null;
      }
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);
  return permission;
}
