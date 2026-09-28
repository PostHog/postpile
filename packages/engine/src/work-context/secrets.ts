// A plain regex pass over everything the sweep collects, before it goes into
// a prompt. It catches the obvious shapes (provider tokens, private keys,
// "password = ..."), not every secret; memory files and prompts rarely hold
// any, and the prompt also tells the agent to leave secrets out.

export const MASK = '[masked]';

/** Whole-match patterns: the match itself is the secret. */
const TOKEN_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b(?:phx|phc|phs)_[A-Za-z0-9]{20,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bnpm_[A-Za-z0-9]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];

/** "Bearer <token>": keep the word, mask the token. */
const BEARER = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g;

/** "password: hunter2", "API_KEY=abc": keep the name, mask the value. */
const ASSIGNMENT =
  /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?)([^\s"'`,;]{6,})/gi;

/** "https://user:pass@host": mask the credentials. */
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi;

export interface MaskResult {
  text: string;
  /** How many secrets were masked. */
  count: number;
}

export function maskSecrets(input: string): MaskResult {
  let count = 0;
  let text = input;
  for (const pattern of TOKEN_PATTERNS) {
    text = text.replace(pattern, () => {
      count += 1;
      return MASK;
    });
  }
  text = text.replace(BEARER, (_match, prefix: string) => {
    count += 1;
    return `${prefix}${MASK}`;
  });
  text = text.replace(ASSIGNMENT, (match, name: string, value: string) => {
    // Already masked by a token pattern above, or a placeholder like <token>.
    if (value.startsWith(MASK) || value.startsWith('<') || value.startsWith('$')) {
      return match;
    }
    count += 1;
    return `${name}${MASK}`;
  });
  text = text.replace(URL_CREDENTIALS, (_match, scheme: string) => {
    count += 1;
    return `${scheme}${MASK}@`;
  });
  return { text, count };
}
