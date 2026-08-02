/**
 * linkify.tsx
 *
 * Utilities for turning raw URLs in text / HTML into interactive links.
 *
 * Exports
 * ─────────────────────────────────────────────────────────────
 * LinkifiedText   — React component for plain-text messages / comments
 * linkifyHtml     — pure-string helper for EditorJS HTML blocks
 */

import React from "react";

// Matches http(s):// URLs and bare www. domains.
// Trailing punctuation is stripped in the normaliser below so
// "Visit https://example.com." doesn't include the period.
const URL_RE =
  /(https?:\/\/[^\s<>"'()\[\]{}]+|(?<![/\w@])www\.[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s<>"'()\[\]{}]*)?)/g;

/** Trim characters that are punctuation but frequently appear right after a URL. */
function trimTrailingPunct(url: string): string {
  return url.replace(/[.,!?:;)\]}'"\s]+$/, "");
}

/** Prefix bare www. urls so the browser treats them as absolute links. */
function ensureScheme(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

// ---------------------------------------------------------------------------
// React component — use for any plain-text field
// ---------------------------------------------------------------------------

interface LinkifiedTextProps {
  text: string;
  /** Extra className applied to each <a> tag (optional). */
  linkClassName?: string;
}

export function LinkifiedText({ text, linkClassName }: LinkifiedTextProps) {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;

  // Reset lastIndex before each call because the regex is module-level with /g.
  const re = new RegExp(URL_RE.source, URL_RE.flags);

  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = trimTrailingPunct(match[0]);
    if (!raw) continue;

    const matchStart = match.index;
    const matchEnd = matchStart + raw.length;

    // Text before this match
    if (matchStart > lastIndex) {
      nodes.push(text.slice(lastIndex, matchStart));
    }

    nodes.push(
      <a
        key={matchStart}
        href={ensureScheme(raw)}
        target="_blank"
        rel="noopener noreferrer"
        className={`underline underline-offset-2 opacity-90 hover:opacity-100 transition-opacity break-all ${linkClassName ?? ""}`}
        // Prevent the link click from triggering parent bubble handlers
        onClick={(e) => e.stopPropagation()}
      >
        {raw}
      </a>,
    );

    lastIndex = matchEnd;
    // Advance re.lastIndex if we shortened the match
    re.lastIndex = matchEnd;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return <>{nodes}</>;
}

// ---------------------------------------------------------------------------
// HTML helper — use for dangerouslySetInnerHTML blocks (EditorJS paragraphs)
// ---------------------------------------------------------------------------

const LINK_CLASSES =
  "underline underline-offset-2 opacity-90 hover:opacity-100 transition-opacity";

/**
 * Processes an HTML string:
 * 1. Adds target="_blank" rel="noopener noreferrer" to every existing <a> tag.
 * 2. Wraps bare URLs in text nodes with <a> tags (skips content already inside a tag).
 */
export function linkifyHtml(html: string): string {
  if (!html) return html;

  // Step 1 — patch existing <a> tags
  let result = html.replace(/<a\b([^>]*)>/gi, (_match, attrs: string) => {
    let a = attrs;
    if (!/target=/i.test(a)) a += ' target="_blank"';
    if (!/rel=/i.test(a)) a += ' rel="noopener noreferrer"';
    // Append our classes if no class attribute exists
    if (!/class=/i.test(a)) a += ` class="${LINK_CLASSES}"`;
    return `<a${a}>`;
  });

  // Step 2 — linkify bare URLs in text nodes only (never inside tag attributes)
  result = result.replace(/(<[^>]+>)|([^<]+)/g, (_match, tag?: string, text?: string) => {
    if (tag) return tag; // return HTML tags verbatim
    if (!text) return _match;

    return text.replace(URL_RE, (raw) => {
      const url = trimTrailingPunct(raw);
      if (!url) return raw;
      const href = ensureScheme(url);
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="${LINK_CLASSES}">${url}</a>`;
    });
  });

  return result;
}
