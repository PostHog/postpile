import { useEffect } from 'react';
import { tabTitle } from '@postpile/core';
import { useBadge } from '../api/badge.ts';
import { isWebPage } from './web-pings.ts';

export function useTabTitle(): void {
  const unreadTopics = useBadge(isWebPage()).data?.unreadTopics;
  useEffect(() => {
    if (unreadTopics !== undefined) {
      document.title = tabTitle(unreadTopics);
    }
  }, [unreadTopics]);
}
