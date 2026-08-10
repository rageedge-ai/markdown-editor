/*
 * Functional tests for the extension.
 *
 *  1. Webview runtime, driven headlessly through test/harness.html
 *  2. The standalone HTML exporter in out/render.js (pure Node)
 */
const puppeteer = require('C:/Users/dev/AppData/Roaming/npm/node_modules/puppeteer-core');
const path = require('path');

const HARNESS = 'file:///' + path.join(__dirname, 'harness.html').replace(/\\/g, '/');
let pass = 0,
  fail = 0;
const ok = (name, cond, detail) => {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : ''));
  }
};

const MD = [
  '# Title',
  '',
  'Some **bold** and _italic_ and `code`.',
  '',
  '- one',
  '- two',
  '',
  '| A | B |',
  '| --- | --- |',
  '| 1 | 2 |',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '> quoted',
].join('\n');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--allow-file-access-from-files'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    const s = m.text();
    if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(s)) {
      errors.push('console: ' + s);
    }
  });
  // the XSS fixture injects <img src=x>; DOMPurify keeps the tag (only the
  // handler is unsafe), so the browser 404s on 'x'. That is the test working.
  page.on('requestfailed', (r) => {
    const f = r.url().split('/').pop();
    if (f !== 'x') {
      errors.push('404: ' + f);
    }
  });

  await page.goto(HARNESS, { waitUntil: 'networkidle0' });
  await page.waitForFunction(() => window.__sent && window.__sent.length > 0, {
    timeout: 10000,
  });

  console.log('\n=== WEBVIEW ===');
  ok(
    'posts {type:ready} on boot',
    await page.evaluate(() => window.__sent[0]?.type === 'ready'),
  );

  // host -> webview init
  await page.evaluate((text) => {
    window.postMessage(
      {
        type: 'init',
        text,
        fileName: 'notes.md',
        config: { defaultView: 'split', previewFont: 'Lora', wordGoal: 10, syncScroll: true },
      },
      '*',
    );
  }, MD);
  await new Promise((r) => setTimeout(r, 500));

  const afterInit = await page.evaluate(() => ({
    cmMounted: !!document.querySelector('#cm .CodeMirror'),
    cmText: document.querySelector('.CodeMirror').CodeMirror.getValue(),
    h1: document.querySelector('#preview h1')?.textContent,
    strong: !!document.querySelector('#preview strong'),
    em: !!document.querySelector('#preview em'),
    table: !!document.querySelector('#preview table td'),
    list: document.querySelectorAll('#preview ul li').length,
    quote: !!document.querySelector('#preview blockquote'),
    hlSpans: document.querySelectorAll('#preview pre code span').length,
    dataLang: document.querySelector('#preview pre')?.getAttribute('data-lang'),
    words: document.getElementById('statWords').textContent,
    goalShown: !document.getElementById('goalWrap').hidden,
    goalLabel: document.getElementById('goalLabel').textContent,
    file: document.getElementById('statFile').textContent,
  }));

  ok('CodeMirror mounts', afterInit.cmMounted);
  ok('document text reaches the editor', afterInit.cmText === MD);
  ok('renders heading', afterInit.h1 === 'Title', 'got: ' + afterInit.h1);
  ok('renders bold + italic', afterInit.strong && afterInit.em);
  ok('renders GFM table', afterInit.table);
  ok('renders list (2 items)', afterInit.list === 2, 'got ' + afterInit.list);
  ok('renders blockquote', afterInit.quote);
  ok('syntax-highlights fenced code', afterInit.hlSpans > 0, 'spans: ' + afterInit.hlSpans);
  ok('tags code fence language', afterInit.dataLang === 'js', 'got: ' + afterInit.dataLang);
  ok('word count populated', /\d+ words/.test(afterInit.words), afterInit.words);
  ok(
    'word goal bar shows when configured',
    afterInit.goalShown && /\/10$/.test(afterInit.goalLabel),
  );
  ok('file name in status bar', afterInit.file === 'notes.md');

  // XSS: DOMPurify must strip script/handlers from untrusted document content
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'update',
        text: '# Hi\n\n<script>window.__pwned=1</script>\n\n<img src=x onerror="window.__pwned=2">',
      },
      '*',
    ),
  );
  await new Promise((r) => setTimeout(r, 350));
  const xss = await page.evaluate(() => ({
    pwned: window.__pwned,
    scriptTags: document.querySelectorAll('#preview script').length,
    onerror: !!document.querySelector('#preview img[onerror]'),
  }));
  ok('sanitises <script> out of the preview', xss.scriptTags === 0 && !xss.pwned);
  ok('sanitises inline event handlers', !xss.onerror);

  // formatting
  await page.evaluate(
    (t) => window.postMessage({ type: 'update', text: t }, '*'),
    'plain line',
  );
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 5 });
    document.querySelector('.ibtn[data-fmt="bold"]').click();
  });
  await new Promise((r) => setTimeout(r, 150));
  ok(
    'bold wraps the selection',
    await page.evaluate(
      () => document.querySelector('.CodeMirror').CodeMirror.getValue() === '**plain** line',
    ),
  );

  // heading prefixes must toggle, not stack
  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.setValue('a heading');
    cm.setCursor({ line: 0, ch: 0 });
    document.querySelector('.ibtn[data-fmt="h1"]').click();
  });
  await new Promise((r) => setTimeout(r, 120));
  const h1once = await page.evaluate(() =>
    document.querySelector('.CodeMirror').CodeMirror.getValue(),
  );
  await page.evaluate(() => document.querySelector('.ibtn[data-fmt="h2"]').click());
  await new Promise((r) => setTimeout(r, 120));
  const thenH2 = await page.evaluate(() =>
    document.querySelector('.CodeMirror').CodeMirror.getValue(),
  );
  ok('H1 applies', h1once === '# a heading', 'got: ' + h1once);
  ok('H2 replaces H1 rather than stacking', thenH2 === '## a heading', 'got: ' + thenH2);

  // debounced edit is posted back to the host
  await page.evaluate(() => {
    window.__sent.length = 0;
  });
  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.setValue('typed'); // triggers change -> pushEdit
  });
  await new Promise((r) => setTimeout(r, 500));
  const edits = await page.evaluate(() => window.__sent.filter((m) => m.type === 'edit'));
  ok(
    'posts a debounced {type:edit} to the host',
    edits.length >= 1 && edits[edits.length - 1].text === 'typed',
    JSON.stringify(edits),
  );
  ok('debounces (not one message per change)', edits.length <= 2, 'sent ' + edits.length);

  // views
  for (const [view, edHidden, pvHidden] of [
    ['editor', false, true],
    ['preview', true, false],
    ['split', false, false],
  ]) {
    await page.evaluate(
      (v) => document.querySelector(`.seg-btn[data-view="${v}"]`).click(),
      view,
    );
    await new Promise((r) => setTimeout(r, 120));
    const st = await page.evaluate(() => ({
      ed: document.getElementById('editorPane').classList.contains('hidden'),
      pv: document.getElementById('previewPane').classList.contains('hidden'),
      sp: document.getElementById('splitter').classList.contains('hidden'),
    }));
    ok(`view "${view}" shows the right panes`, st.ed === edHidden && st.pv === pvHidden);
  }

  // toolbar -> host command routing
  // export lives in the "⋯" menu now
  await page.evaluate(() => {
    window.__sent.length = 0;
    document.getElementById('moreBtn').click();
    document.querySelector('[data-command="markdownCoIn.exportHtml"]').click();
  });
  ok(
    'toolbar routes to a VS Code command',
    await page.evaluate(() =>
      window.__sent.some(
        (m) => m.type === 'command' && m.command === 'markdownCoIn.exportHtml',
      ),
    ),
  );

  // focus mode
  await page.evaluate(() => document.getElementById('focusBtn').click());
  ok(
    'focus mode hides chrome',
    await page.evaluate(
      () => getComputedStyle(document.getElementById('toolbar')).display === 'none',
    ),
  );
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 120));
  ok(
    'Escape exits focus mode',
    await page.evaluate(() => !document.getElementById('app').classList.contains('focus')),
  );

  // theme following
  await page.evaluate(() => {
    document.body.className = 'vscode-light';
  });
  await new Promise((r) => setTimeout(r, 200));
  ok(
    'highlight.js theme follows VS Code light/dark',
    await page.evaluate(
      () =>
        !document.getElementById('hlLight').disabled &&
        document.getElementById('hlDark').disabled,
    ),
  );

  // ── rich (live) editing ────────────────────────────────
  await page.evaluate(() =>
    window.postMessage(
      {
        type: 'update',
        text: '# Big heading\n\nsome **bold** words\n\n```js\nlet a = 1;\n```\n\n> a quote',
      },
      '*',
    ),
  );
  await new Promise((r) => setTimeout(r, 450));

  ok(
    'rich mode is on by default',
    await page.evaluate(() => document.getElementById('app').classList.contains('md-rich')),
  );

  ok(
    'mode emits cm-formatting tokens',
    await page.evaluate(
      () =>
        document.querySelectorAll('#cm .cm-formatting-header, #cm .cm-formatting-strong')
          .length > 0,
    ),
  );

  ok(
    'headings are visually scaled up',
    await page.evaluate(() => {
      // :not(.cm-formatting) — the first .cm-header-1 is the '#' marker span,
      // which is deliberately shrunk when revealed. We want the heading text.
      const h = document.querySelector('#cm .cm-header-1:not(.cm-formatting)');
      const base = parseFloat(
        getComputedStyle(document.querySelector('#cm .CodeMirror')).fontSize,
      );
      return h && parseFloat(getComputedStyle(h).fontSize) > base * 1.5;
    }),
  );

  ok(
    'bold renders bold in the editor',
    await page.evaluate(() => {
      const b = document.querySelector('#cm .cm-strong');
      return b && parseInt(getComputedStyle(b).fontWeight, 10) >= 700;
    }),
  );

  // blur: every marker should vanish
  await page.evaluate(() => {
    document.querySelector('.CodeMirror').CodeMirror.getInputField().blur();
  });
  await new Promise((r) => setTimeout(r, 200));
  ok(
    'unfocused editor hides every syntax marker',
    await page.evaluate(() =>
      [
        ...document.querySelectorAll('#cm .cm-formatting-header, #cm .cm-formatting-strong'),
      ].every((el) => getComputedStyle(el).display === 'none'),
    ),
  );

  // focus + put the cursor on the heading: that line reveals its markers
  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.focus();
    cm.setCursor({ line: 0, ch: 3 });
  });
  await new Promise((r) => setTimeout(r, 250));
  const reveal = await page.evaluate(() => {
    const active = document.querySelector('#cm .CodeMirror-activeline .cm-formatting-header');
    const inactive = [...document.querySelectorAll('#cm .cm-formatting-strong')];
    return {
      activeShown: active ? getComputedStyle(active).display !== 'none' : null,
      othersHidden: inactive.every((el) => getComputedStyle(el).display === 'none'),
    };
  });
  ok(
    'cursor line reveals its own markers',
    reveal.activeShown === true,
    'got ' + reveal.activeShown,
  );
  ok('other lines stay rendered', reveal.othersHidden);

  ok(
    'fenced code lines get a monospace slab',
    await page.evaluate(() => document.querySelectorAll('#cm .md-code-line').length >= 3),
  );
  ok(
    'quote lines get a quote class',
    await page.evaluate(() => document.querySelectorAll('#cm .md-quote-line').length >= 1),
  );

  // toggle to raw
  await page.evaluate(() => {
    window.__sent.length = 0;
    document.getElementById('richBtn').click();
  });
  await new Promise((r) => setTimeout(r, 250));
  const raw = await page.evaluate(() => ({
    off: !document.getElementById('app').classList.contains('md-rich'),
    label: document.getElementById('richBtn').getAttribute('aria-pressed'),
    markersVisible: [...document.querySelectorAll('#cm .cm-formatting-header')].every(
      (el) => getComputedStyle(el).display !== 'none',
    ),
    persisted: window.__sent.some(
      (m) => m.type === 'setConfig' && m.key === 'richEditing' && m.value === false,
    ),
  }));
  ok('Raw toggle turns live rendering off', raw.off);
  ok('toggle reflects state via aria-pressed', raw.label === 'false', 'got: ' + raw.label);
  ok('raw mode shows all markers again', raw.markersVisible);
  ok('toggle persists to settings', raw.persisted);
  await page.evaluate(() => document.getElementById('richBtn').click());
  await new Promise((r) => setTimeout(r, 200));

  // the document itself must be untouched by any of this
  ok(
    'hiding markers never alters the document',
    await page.evaluate(() =>
      document.querySelector('.CodeMirror').CodeMirror.getValue().includes('# Big heading'),
    ),
  );

  // ── task list checkboxes ────────────────────────────────
  // CodeMirror tags "[ ]" as link brackets, which rich mode hides — so these
  // silently vanished. They are replaced with real checkbox widgets instead.
  const TASKS = ['- [ ] first', '- [x] second', '- plain'].join('\n');
  await page.evaluate((t) => window.postMessage({ type: 'update', text: t }, '*'), TASKS);
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() =>
    document.querySelector('.CodeMirror').CodeMirror.getInputField().blur(),
  );
  await new Promise((r) => setTimeout(r, 350));

  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll('#cm .md-task')].map((b) => b.checked),
  );
  ok('task items render as checkboxes', boxes.length === 2, 'got ' + boxes.length);
  ok(
    'checkbox state matches [ ] / [x]',
    boxes[0] === false && boxes[1] === true,
    JSON.stringify(boxes),
  );
  ok(
    'no bare "x" leaks into the line',
    await page.evaluate(() => {
      const l = document.querySelectorAll('#cm .CodeMirror-line')[1];
      const shown = [...l.querySelectorAll('span')]
        .filter((s) => !s.querySelector('span'))
        .filter((s) => getComputedStyle(s).display !== 'none')
        .map((s) => s.textContent)
        .join('');
      // the old bug left a naked 'x' where '[x]' had been
      return !/(^|s)x(s|$)/.test(shown) && !shown.includes('[') && shown.includes('second');
    }),
  );

  await page.evaluate(() =>
    document
      .querySelector('#cm .md-task')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true })),
  );
  await new Promise((r) => setTimeout(r, 400));
  ok(
    'clicking a checkbox edits the document',
    await page.evaluate(() =>
      document.querySelector('.CodeMirror').CodeMirror.getValue().startsWith('- [x] first'),
    ),
  );

  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.focus();
    cm.setCursor({ line: 1, ch: 8 });
  });
  await new Promise((r) => setTimeout(r, 400));
  ok(
    'cursor line shows raw [x] for editing',
    await page.evaluate(() => {
      const l = document.querySelectorAll('#cm .CodeMirror-line')[1];
      return (
        l.textContent.includes('[x]') && document.querySelectorAll('#cm .md-task').length === 1
      );
    }),
  );

  // ── toolbar density / native icons ─────────────────────
  const bar = await page.evaluate(() => ({
    // only the visible row — popover items are nested inside .toolbar too
    controls: [...document.querySelectorAll('.toolbar button')].filter(
      (x) => !x.closest('.pop'),
    ).length,
    hidden: document.querySelectorAll('.pop button').length,
    codicons: document.querySelectorAll('.toolbar .codicon').length,
    emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(
      document.getElementById('toolbar').textContent,
    ),
    height: document.getElementById('toolbar').getBoundingClientRect().height,
    popsClosed: document.querySelectorAll('.pop.open').length,
  }));
  ok('toolbar row stays small (<= 14 controls)', bar.controls <= 14, 'got ' + bar.controls);
  ok('long tail moved into menus', bar.hidden >= 8, 'got ' + bar.hidden);
  ok('toolbar uses Codicons', bar.codicons >= 8, 'got ' + bar.codicons);
  ok('no emoji left in the toolbar', !bar.emoji);
  ok('toolbar is one compact row', bar.height <= 34, 'got ' + bar.height + 'px');
  ok('popovers start closed', bar.popsClosed === 0);

  await page.evaluate(() => document.getElementById('fmtMore').click());
  await new Promise((r) => setTimeout(r, 120));
  ok(
    'format overflow opens',
    await page.evaluate(() => document.getElementById('fmtPop').classList.contains('open')),
  );
  await page.evaluate(() => {
    const cm = document.querySelector('.CodeMirror').CodeMirror;
    cm.setValue('quote me');
    cm.setCursor({ line: 0, ch: 0 });
    document.querySelector('.pop-item[data-fmt="quote"]').click();
  });
  await new Promise((r) => setTimeout(r, 200));
  ok(
    'overflow item applies and closes the menu',
    await page.evaluate(
      () =>
        document.querySelector('.CodeMirror').CodeMirror.getValue() === '> quote me' &&
        !document.getElementById('fmtPop').classList.contains('open'),
    ),
  );

  await page.evaluate(() => document.getElementById('moreBtn').click());
  await new Promise((r) => setTimeout(r, 100));
  await page.evaluate(() => document.body.click());
  await new Promise((r) => setTimeout(r, 120));
  ok(
    'clicking away dismisses the menu',
    await page.evaluate(() => document.querySelectorAll('.pop.open').length === 0),
  );

  console.log(
    '\n  runtime errors: ' + (errors.length ? '\n    ' + errors.join('\n    ') : 'none'),
  );
  if (errors.length) {
    fail++;
  }
  await browser.close();

  // ── exporter ─────────────────────────────────────────────
  console.log('\n=== HTML EXPORT (out/render.js) ===');
  const { renderStandaloneHtml, renderBody } = require('../out/render.js');
  const body = renderBody(MD);
  ok('exports heading', /<h1>Title<\/h1>/.test(body));
  ok(
    'exports bold + italic',
    /<strong>bold<\/strong>/.test(body) && /<em>italic<\/em>/.test(body),
  );
  ok('exports inline code escaped', /<code>code<\/code>/.test(body));
  ok('exports list', /<ul>[\s\S]*<li>one<\/li>/.test(body));
  ok('exports table', /<table><thead><tr><th>A<\/th>/.test(body));
  ok(
    'exports fenced code with language',
    /<pre data-lang="js"><code>const x = 1;<\/code><\/pre>/.test(body),
  );
  ok('exports blockquote', /<blockquote>[\s\S]*quoted/.test(body));

  const evil = renderBody('# <script>alert(1)</script>\n\nx <b>y</b>');
  ok(
    'escapes HTML in exported markdown',
    !/<script>/.test(evil) && /&lt;script&gt;/.test(evil),
  );

  const doc = renderStandaloneHtml(MD, 'notes');
  ok(
    'export is a complete document',
    /^<!DOCTYPE html>/.test(doc) && /<\/html>/.test(doc.trim()),
  );
  ok(
    'export is self-contained (no external refs)',
    !/(https?:)?\/\/(cdn|fonts|unpkg|jsdelivr)/.test(doc),
  );
  ok('export has print styles', /@media print/.test(doc));
  ok(
    'print variant auto-opens the dialog',
    /window\.print\(\)/.test(renderStandaloneHtml(MD, 'n', true)),
  );
  ok('non-print variant does not', !/window\.print\(\)/.test(doc));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
