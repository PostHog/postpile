import { useState } from 'react';
import { avatarTone, avatarUrl, initials, isTeam } from '../lib/people.ts';

const SIZES = {
  sm: { box: 'size-[18px] text-[7px]', px: 36 },
  md: { box: 'size-[22px] text-[8.5px]', px: 44 },
};

/**
 * The GitHub avatar over initials in a tone picked from the login. The
 * initials show while the image loads and stay when it fails (fake logins
 * 404), so the box never changes size. Teams get a rounded square.
 */
export function Avatar(props: { login: string; size?: 'sm' | 'md'; className?: string }) {
  const size = SIZES[props.size ?? 'sm'];
  const url = avatarUrl(props.login, size.px);
  // Kept per URL, so a reused Avatar with another login starts over.
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const shape = isTeam(props.login) ? 'rounded-md' : 'rounded-full';
  return (
    <span
      title={props.login}
      className={`relative flex shrink-0 items-center justify-center font-bold ${size.box} ${shape} ${avatarTone(props.login)} ${props.className ?? ''}`}
    >
      {initials(props.login)}
      {url && url !== failedUrl && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
          className={`absolute inset-0 size-full ${shape} object-cover ${url === loadedUrl ? '' : 'opacity-0'}`}
        />
      )}
    </span>
  );
}
