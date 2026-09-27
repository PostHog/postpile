/** Tailwind classes per avatar tone. Listed in full so Tailwind finds them. */
const AVATAR_TONES = [
  'bg-avatar-blue text-avatar-blue-ink',
  'bg-avatar-green text-avatar-green-ink',
  'bg-avatar-purple text-avatar-purple-ink',
  'bg-avatar-orange text-avatar-orange-ink',
];

const BOT_TONE = 'bg-avatar-grey text-avatar-grey-ink';

export function isBotLogin(login: string): boolean {
  return login.endsWith('[bot]');
}

export function isTeam(login: string): boolean {
  return login.includes('/');
}

/** "rowan" -> "RA", "renovate[bot]" -> "RE", "PostHog/team-devex" -> "TE". */
export function initials(login: string): string {
  const name = login.replace(/\[bot\]$/, '').split('/').pop() ?? login;
  return name.slice(0, 2).toUpperCase();
}

/** Same login, same tone, on every screen. Bots and teams stay grey. */
export function avatarTone(login: string): string {
  if (isBotLogin(login) || isTeam(login)) {
    return BOT_TONE;
  }
  let sum = 0;
  for (const char of login) {
    sum += char.charCodeAt(0);
  }
  return AVATAR_TONES[sum % AVATAR_TONES.length] ?? BOT_TONE;
}
