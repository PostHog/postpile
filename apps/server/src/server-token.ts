import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const SERVER_TOKEN_FILE_NAME = 'server-token';

const MIN_TOKEN_LENGTH = 32;

function freshToken(): string {
  return randomBytes(24).toString('hex');
}

export function serverToken(env: NodeJS.ProcessEnv, tokenFile: string | null): string {
  if (env.POSTPILE_TOKEN) {
    return env.POSTPILE_TOKEN;
  }
  if (tokenFile === null) {
    return freshToken();
  }
  if (existsSync(tokenFile)) {
    const stored = readFileSync(tokenFile, 'utf8').trim();
    if (stored.length >= MIN_TOKEN_LENGTH) {
      return stored;
    }
  }
  const token = freshToken();
  mkdirSync(dirname(tokenFile), { recursive: true });
  writeFileSync(tokenFile, `${token}\n`, { mode: 0o600 });
  return token;
}
