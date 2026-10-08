// HTML comments (bot markers) out of GitHub text, in one pass with
// indexOf: a regex like /<!--[\s\S]*?-->/g runs in quadratic time on text
// with many "<!--" and no "-->", and GitHub text is anyone's input.

/** `text` without its HTML comments; an unclosed "<!--" hides the rest of the text, as on github.com. */
export function stripHtmlComments(text: string): string {
  let result = '';
  let from = 0;
  for (;;) {
    const open = text.indexOf('<!--', from);
    if (open === -1) {
      return result + text.slice(from);
    }
    result += text.slice(from, open);
    const close = text.indexOf('-->', open + 4);
    if (close === -1) {
      return result;
    }
    from = close + 3;
  }
}
