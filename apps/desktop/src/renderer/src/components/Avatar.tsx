import { useState } from 'react';
import { useAppConfig } from '../api/config.ts';
import { avatarTone, avatarUrl, initials, isTeam } from '../lib/people.ts';

const SIZES = {
  xxs: { box: 'size-3.5 text-[6px]', px: 28 },
  xs: { box: 'size-4 text-[6.5px]', px: 32 },
  sm: { box: 'size-[18px] text-[7px]', px: 36 },
  mid: { box: 'size-5 text-[7.5px]', px: 40 },
  md: { box: 'size-[22px] text-[8.5px]', px: 44 },
  lg: { box: 'size-6 text-[9px]', px: 48 },
};

/**
 * The GitHub avatar over initials in a tone picked from the login. The
 * initials show while the image loads and stay when it fails, so the box
 * never changes size. Teams get a rounded square. Sample data shows only
 * initials: remote avatars load once the config says the data is real.
 */
export function Avatar(props: { login: string; size?: keyof typeof SIZES; className?: string }) {
  const size = SIZES[props.size ?? 'sm'];
  const realData = useAppConfig().data?.fake === false;
  const url = avatarUrl(props.login, size.px, realData);
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
