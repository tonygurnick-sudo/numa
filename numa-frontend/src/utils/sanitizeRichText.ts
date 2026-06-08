import DOMPurify from 'dompurify';

/**
 * Allow-list of inline `style` properties that rich-text comments / descriptions
 * are permitted to carry. Everything else is stripped.
 *
 * We deliberately use an allow-list rather than a deny-list. Content pasted from
 * web apps (Slack/Discord-style chat panes, dark-themed editors, Word, Docs)
 * drags in dozens of layout/visual declarations — `background-color`, `border`,
 * `box-shadow`, `display:flex`, `position`, `padding`, `width`, `overflow`, … —
 * that turn a comment into a styled box (the BUG-141 "black bar": a
 * `background-color: rgb(24,24,24); color: rgb(0,0,0); display:flex` container).
 * A deny-list is whack-a-mole; new pastes always smuggle in a property we forgot.
 *
 * A comment should only ever render formatted *text*, so we keep just the
 * properties the editor itself emits for text formatting (Color / FontFamily
 * extensions, table column widths, alignment) and drop everything structural.
 */
const SAFE_STYLE_PROPS = new Set([
  'color',
  'font-family',
  'text-align',
  'text-decoration',
  'width', // table column widths emitted by the editor
]);

/** Keep only allow-listed declarations from a single inline `style` string,
 *  returning the remaining declarations joined back together (empty if none). */
function filterStyle(style: string): string {
  return style
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((rule) => {
      const prop = rule.split(':')[0]?.trim().toLowerCase();
      return !!prop && SAFE_STYLE_PROPS.has(prop);
    })
    .join('; ');
}

/** Walk an HTML string and reduce every element's inline style to the allow-list.
 *  When `dropClass` is set, class attributes are removed too (used on paste to
 *  shed editor cruft; display keeps classes so semantic styling such as
 *  `.ops-mention` survives). */
function stripUnsafeStyles(html: string, dropClass: boolean): string {
  if (!html) return html;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.body.querySelectorAll('*').forEach((el) => {
      if (dropClass) el.removeAttribute('class');
      const style = el.getAttribute('style');
      if (!style) return;
      const kept = filterStyle(style);
      if (kept) el.setAttribute('style', kept);
      else el.removeAttribute('style');
    });
    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Clean HTML pasted into the rich-text editor: drop class cruft and reduce inline
 * styles to the safe allow-list, keeping structure and bold/italic/underline.
 * Applied via Tiptap's `transformPastedHTML`.
 */
export function cleanPastedHtml(html: string): string {
  return stripUnsafeStyles(html, true);
}

/**
 * Sanitize stored rich-text HTML for read-only display. Two passes:
 *   1. DOMPurify — neutralises XSS (scripts, event handlers, javascript: URLs),
 *      since the result is fed to `dangerouslySetInnerHTML`.
 *   2. allow-list inline styles — strips layout/visual declarations (dark
 *      backgrounds, borders, flex containers, …) that would otherwise render a
 *      comment as a styled box instead of plain formatted text.
 *
 * Classes are preserved so `.ops-mention` and similar styling keep working.
 */
export function sanitizeRichTextHtml(html: string): string {
  if (!html) return html;
  const safe = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  return stripUnsafeStyles(safe, false);
}
