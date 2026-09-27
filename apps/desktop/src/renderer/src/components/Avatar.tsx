import { avatarTone, initials, isTeam } from '../lib/people.ts';

/** Initials in a tone picked from the login. Teams get a rounded square. */
export function Avatar(props: { login: string; size?: 'sm' | 'md'; className?: string }) {
  const size = props.size === 'md' ? 'size-[22px] text-[8.5px]' : 'size-[18px] text-[7px]';
  const shape = isTeam(props.login) ? 'rounded-md' : 'rounded-full';
  return (
    <span
      title={props.login}
      className={`relative flex shrink-0 items-center justify-center font-bold ${size} ${shape} ${avatarTone(props.login)} ${props.className ?? ''}`}
    >
      {initials(props.login)}
    </span>
  );
}
