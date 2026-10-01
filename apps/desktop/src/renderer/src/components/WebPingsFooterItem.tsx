import { useActions } from '../api/actions.tsx';
import type { WebPingPermission } from '../lib/web-pings.ts';

export function WebPingsFooterItem(props: { permission: WebPingPermission }) {
  const actions = useActions();
  const permission = props.permission;
  if (permission === 'unsupported') {
    return <span title="This browser cannot show notifications; pings only show as unread tiles">pings: unsupported</span>;
  }
  if (permission === 'denied') {
    return (
      <span className="text-closer" title="Notifications are blocked for this page. Allow them in the browser's site settings to get pings.">
        pings: blocked
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void actions.sendTestNotification()}
      title="Ask the browser to show pings, then send a test one"
      className="text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink"
    >
      pings: off · turn on
    </button>
  );
}
