/*
 * Standalone HTML export.
 *
 * Runs in the extension host (Node), not the webview, so it cannot reuse the
 * webview's marked/DOMPurify instances. It ships a small, dependency-free
 * CommonMark-subset renderer instead — enough for export fidelity without
 * pulling a parser into the extension bundle.
 *
 * Output is a single self-contained file: no CDN, no external CSS.
 */

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Placeholder sentinel used while code spans are parked.
 *
 * NUL is deliberate: it cannot occur in real Markdown, so a document
 * containing text like "then 0 then 1" can never be mistaken for a parked
 * span. Written as an escape rather than a raw byte, which is invisible in
 * an editor and easy to delete by accident.
 */
const SENTINEL = '\u0000';

/**
 * Renders the inline (span-level) syntax of a single block of Markdown.
 *
 * Code spans are lifted out first and restored last, so their contents are
 * never re-interpreted as emphasis or link syntax — `**not bold**` inside
 * backticks must survive verbatim.
 *
 * @param s Raw Markdown for one block. Must not already contain NUL.
 * @returns HTML with all text outside code spans escaped.
 */
function inline(s: string): string {
  const spans: string[] = [];
  s = s.replace(/`([^`]+)`/g, (_m, c) => {
    spans.push(`<code>${esc(c)}</code>`);
    return `${SENTINEL}${spans.length - 1}${SENTINEL}`;
  });

  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<img alt="$1" src="$2">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, '<a href="$2">$1</a>');
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w_])__([^_]+)__/g, '$1<strong>$2</strong>');
  s = s.replace(/(^|[^\w_])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // eslint-disable-next-line no-control-regex -- NUL is the sentinel, see above
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => spans[Number(i)]);
}

/**
 * Converts Markdown to an HTML fragment.
 *
 * Deliberately a subset — headings, lists (including task lists), fenced
 * code, blockquotes, pipe tables, rules and paragraphs. Enough for faithful
 * export without pulling a full parser into the extension host, where it
 * would be loaded on every activation.
 *
 * Recurses for blockquote contents, so nesting works.
 *
 * @param md Markdown source. CRLF is normalised.
 * @returns An HTML fragment; all text is escaped.
 */
export function renderBody(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  let listType: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      closeList();
      const lang = fence[1];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      out.push(
        `<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(buf.join('\n'))}</code></pre>`,
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const n = heading[1].length;
      out.push(`<h${n}>${inline(heading[2].trim())}</h${n}>`);
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      closeList();
      out.push('<hr>');
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      closeList();
      const buf: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderBody(buf.join('\n'))}</blockquote>`);
      continue;
    }

    // Pipe table: header row, delimiter row, then body rows
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      closeList();
      const cells = (r: string) =>
        r
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        body.push(cells(lines[i]));
        i++;
      }
      out.push(
        '<table><thead><tr>' +
          head.map((c) => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body
            .map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
            .join('') +
          '</tbody></table>',
      );
      continue;
    }

    const li = line.match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const kind: 'ul' | 'ol' = /^\d/.test(li[1]) ? 'ol' : 'ul';
      if (listType !== kind) {
        closeList();
        out.push(`<${kind}>`);
        listType = kind;
      }
      const item = li[2];
      const task = item.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
        out.push(
          `<li class="task"><input type="checkbox" disabled${checked}> ${inline(task[2])}</li>`,
        );
      } else {
        out.push(`<li>${inline(item)}</li>`);
      }
      i++;
      continue;
    }

    if (!line.trim()) {
      closeList();
      i++;
      continue;
    }

    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,6}\s|```|\s*>|\s*([-*+]|\d+[.)])\s)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    closeList();
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
  }
  closeList();
  return out.join('\n');
}

/**
 * Wraps {@link renderBody} in a complete, self-contained HTML document.
 *
 * All styling is inlined — no CDN, no external stylesheet — so the exported
 * file renders identically on a machine with no network.
 *
 * @param md Markdown source.
 * @param title Document title, used for `<title>`.
 * @returns A full HTML document.
 */
export function renderStandaloneHtml(md: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 48px 24px;
    background: #fcfcfc; color: #3b3b3b;
    font: 16px/1.75 Georgia, 'Times New Roman', serif;
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1, h2, h3, h4, h5, h6 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #1f1f1f; line-height: 1.25; margin: 1.8em 0 .5em; letter-spacing: -.02em;
  }
  h1 { font-size: 2em; margin-top: 0; border-bottom: 1px solid #dcdcdc; padding-bottom: .3em; }
  h2 { font-size: 1.45em; border-bottom: 1px solid #e6e6e6; padding-bottom: .25em; }
  h3 { font-size: 1.15em; }
  p { margin: 1em 0; }
  a { color: #3f6212; }
  strong { color: #1f1f1f; }
  code {
    font: .85em/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: #f0f0f0; border: 1px solid #e2e2e2; border-radius: 4px; padding: .1em .4em;
    color: #a31515;
  }
  pre {
    background: #f1f1f1; border: 1px solid #e2e2e2; border-radius: 8px;
    padding: 16px 18px; overflow-x: auto; margin: 1.5em 0; position: relative;
  }
  pre code { background: none; border: 0; padding: 0; color: #3b3b3b; font-size: .85em; }
  pre[data-lang]::before {
    content: attr(data-lang); position: absolute; top: 8px; right: 12px;
    font: 600 10px/1 ui-monospace, monospace; letter-spacing: .08em;
    text-transform: uppercase; color: #9a9a9a;
  }
  blockquote {
    margin: 1.5em 0; padding: .6em 1.1em; background: #f1f1f1;
    border-left: 3px solid #3f6212; border-radius: 0 6px 6px 0; color: #4a4a4a;
  }
  blockquote p:first-child { margin-top: 0; }
  blockquote p:last-child { margin-bottom: 0; }
  ul, ol { padding-left: 1.5em; margin: 1em 0; }
  li { margin: .35em 0; }
  li.task { list-style: none; margin-left: -1.2em; }
  table {
    width: 100%; border-collapse: collapse; margin: 1.5em 0;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  th, td { border: 1px solid #dcdcdc; padding: 8px 12px; text-align: left; }
  th { background: #ebebeb; font-weight: 700; }
  img { max-width: 100%; border-radius: 6px; }
  hr { border: 0; border-top: 1px solid #dcdcdc; margin: 2.5em 0; }
  @media print {
    body { padding: 0; background: #fff; }
    pre, blockquote, table { break-inside: avoid; }
    h1, h2, h3 { break-after: avoid; }
    a { color: #3f6212; text-decoration: underline; }
  }
</style>
</head>
<body>
<main>
${renderBody(md)}
</main>
</body>
</html>
`;
}
