// Pure helpers for rendering a PR description (GitHub markdown, untrusted).

/**
 * The PR body as worth showing: HTML comments dropped (PR templates are
 * full of `<!-- fill this in -->`), runs of blank lines squeezed, trimmed.
 * Empty means "no description": the section is left out.
 */
export function cleanPrBody(body: string): string {
  return body
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Links in a description open in the browser only when absolute http(s) or
 * mailto. Relative links ("docs/x.md") would resolve against the app's own
 * page and javascript: must never run, so both render as plain text.
 */
export function safeLinkUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ['https:', 'http:', 'mailto:'].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}
