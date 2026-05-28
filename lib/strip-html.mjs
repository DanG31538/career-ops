/**
 * lib/strip-html.mjs — Plain-text extraction from HTML JD content.
 *
 * Used by providers/*.mjs fetchJobDetail() implementations. ATS APIs
 * typically return job descriptions as HTML (especially Greenhouse); we
 * need plain text suitable for feeding into llm-eval.mjs.
 *
 * Conservative: preserves paragraph + list structure as plain text,
 * decodes common HTML entities, collapses redundant whitespace.
 */
export function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';

  return html
    // Remove scripts and styles entirely
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    // Block-level breaks become newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(?:ul|ol)\s*>/gi, '\n')
    // Strip everything else
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&hellip;/g, '...')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&rdquo;/g, '"')
    .replace(/&ldquo;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
