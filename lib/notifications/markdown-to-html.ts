/**
 * Lightweight Markdown→HTML converter + allowlist sanitizer for patron email bodies.
 *
 * Covers the subset of Markdown emitted by the AI-draft tool and librarian editors:
 *   - ATX headings (# / ## / ###)
 *   - Bold (**text**) and italic (*text*)
 *   - Unordered lists (- / * / + items) and ordered lists (1. items)
 *   - Inline links ([text](url)) — javascript: URLs are stripped
 *   - Paragraphs (blank-line separated) and line breaks
 *
 * After conversion the HTML is sanitized through an allowlist of safe tags:
 *   h1, h2, h3, p, strong, em, ul, ol, li, a (href only, no javascript:), br
 *
 * NO external dependency: the Markdown subset is small and well-defined, a
 * hand-rolled renderer is safer and avoids adding marked + DOMPurify to the
 * bundle (DOMPurify requires a DOM, unavailable in Node/React-Email rendering).
 *
 * Usage:
 *   import { markdownToHtml } from "@/lib/notifications/markdown-to-html";
 *   const html = markdownToHtml(markdownString);
 */

// ---------------------------------------------------------------------------
// Allowlist sanitizer
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set(["h1", "h2", "h3", "p", "strong", "em", "ul", "ol", "li", "a", "br"]);

/** Strips all tags not in the allowlist. Sanitizes href on <a> tags. */
function sanitize(html: string): string {
  // First: remove dangerous block elements along with their entire content
  // (script, style, iframe, etc.). A simple regex is sufficient because the
  // input was escaped with escapeHtml() before block assembly, so any <script>
  // at this point originated from raw HTML in the Markdown source.
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "");

  // Second: strip or neutralise every remaining tag that is not in the allowlist.
  out = out.replace(/<(\/?)(\w+)([^>]*)>/g, (_match, slash, tag, attrs) => {
    const lower = tag.toLowerCase();
    if (!ALLOWED_TAGS.has(lower)) return ""; // strip unknown tags, keep text

    if (lower === "a") {
      // Extract href only; block javascript: and data: URIs.
      const hrefMatch = /href\s*=\s*["']([^"']*)["']/i.exec(attrs);
      if (!hrefMatch) return `<${slash}a>`;
      const href = hrefMatch[1] ?? "";
      if (/^\s*javascript:/i.test(href) || /^\s*data:/i.test(href)) {
        return `<${slash}a>`; // href stripped — keep tag but no href
      }
      return `<${slash}a href="${escapeAttr(href)}">`;
    }

    // All other allowed tags: no attributes permitted.
    return `<${slash}${lower}>`;
  });

  return out;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Inline-level Markdown transforms
// ---------------------------------------------------------------------------

function processInline(raw: string): string {
  // Bold (**text** or __text__)
  let out = raw.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic (*text* or _text_) — must come after bold
  out = out.replace(/\*(.+?)\*/g, "<em>$1</em>");
  out = out.replace(/_(.+?)_/g, "<em>$1</em>");
  // Links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const safe = /^\s*javascript:/i.test(url) || /^\s*data:/i.test(url) ? "#" : url;
    return `<a href="${escapeAttr(safe)}">${label}</a>`;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Block-level Markdown transforms
// ---------------------------------------------------------------------------

/**
 * Converts Markdown to an HTML string and sanitizes the result.
 *
 * @param markdown Raw Markdown content from AI draft or librarian editor.
 * @returns Sanitized HTML ready for injection into `dangerouslySetInnerHTML`.
 */
export function markdownToHtml(markdown: string): string {
  // Pre-sanitize: strip dangerous raw HTML that may be embedded in the Markdown
  // source before any escaping occurs. We must do this on the raw string because
  // escapeHtml() will turn `<` into `&lt;` and the later sanitize() regex will
  // then never match the tag delimiters.
  const stripped = markdown
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
    // Strip any remaining raw HTML tags (e.g. <div>, <span onclick=...>) from
    // the source; text content is preserved, only the tags are removed.
    .replace(/<[^>]+>/g, "");

  // Normalise line endings.
  const lines = stripped.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

  const blocks: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // ── ATX Headings ──────────────────────────────────────────────────────
    const headingMatch = /^(#{1,3})\s+(.+)$/.exec(line);
    if (headingMatch) {
      const level = (headingMatch[1] ?? "").length;
      const content = escapeHtml(headingMatch[2] ?? "");
      blocks.push(`<h${level}>${processInline(content)}</h${level}>`);
      i++;
      continue;
    }

    // ── Unordered list ────────────────────────────────────────────────────
    const ulMatch = /^[\-\*\+]\s+(.+)$/.exec(line);
    if (ulMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        const m = /^[\-\*\+]\s+(.+)$/.exec(cur);
        if (!m) break;
        items.push(`<li>${processInline(escapeHtml(m[1] ?? ""))}</li>`);
        i++;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // ── Ordered list ──────────────────────────────────────────────────────
    const olMatch = /^\d+\.\s+(.+)$/.exec(line);
    if (olMatch) {
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? "";
        const m = /^\d+\.\s+(.+)$/.exec(cur);
        if (!m) break;
        items.push(`<li>${processInline(escapeHtml(m[1] ?? ""))}</li>`);
        i++;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // ── Blank line (paragraph separator) ─────────────────────────────────
    if (line.trim() === "") {
      i++;
      continue;
    }

    // ── Paragraph ─────────────────────────────────────────────────────────
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = lines[i] ?? "";
      if (cur.trim() === "") break;
      // Stop if the next line is a structural element.
      if (/^#{1,3}\s/.test(cur) || /^[\-\*\+]\s/.test(cur) || /^\d+\.\s/.test(cur)) break;
      paraLines.push(escapeHtml(cur));
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(`<p>${processInline(paraLines.join("<br>"))}</p>`);
    }
  }

  const rawHtml = blocks.join("");

  // Final sanitize pass — guards against any inline HTML smuggled through the
  // Markdown source (e.g. <script> injected inside a paragraph or link label).
  return sanitize(rawHtml);
}
