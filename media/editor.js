(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);

  let cm = null;
  let applyingRemote = false; // guards the host -> webview -> host echo
  let syncing = false; // guards the scroll-sync feedback loop
  let richMode = true;
  let gotInit = false;
  let config = {
    defaultView: 'split',
    previewFont: 'Lora',
    wordGoal: 0,
    syncScroll: true,
    richEditing: true,
  };

  /* ── Markdown pipeline ─────────────────────────────────── */
  // marked v9 dropped the `highlight` option (it moved to the separate
  // marked-highlight package) — passing it here is silently ignored. We
  // highlight the rendered DOM afterwards instead, which needs no extra dep.
  marked.setOptions({ gfm: true, breaks: false });

  /**
   * Renders Markdown into the preview pane.
   *
   * The document is untrusted — it may be a file from anywhere — so output
   * is sanitised before it touches the DOM, even though the webview is
   * already sandboxed.
   *
   * @param {string} md Markdown source.
   */
  function render(md) {
    const dirty = marked.parse(md || '');
    // The webview is sandboxed, but the document itself is untrusted input and
    // may be someone else's file — sanitise before it reaches the DOM.
    const clean = DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });
    const el = $('preview');
    el.innerHTML = clean;
    el.querySelectorAll('pre > code').forEach((block) => {
      const cls = [...block.classList].find((c) => c.startsWith('language-'));
      if (cls) {
        block.parentElement.setAttribute('data-lang', cls.slice(9));
      }
      try {
        // Unknown languages would throw; an unhighlighted block is fine.
        if (!cls || hljs.getLanguage(cls.slice(9))) {
          hljs.highlightElement(block);
        }
      } catch {
        // Unknown language: leaving the block unhighlighted is the right
        // outcome, not an error worth surfacing.
      }
    });
    el.querySelectorAll('input[type=checkbox]').forEach((c) => {
      c.disabled = true;
    });
  }

  /* ── Stats ─────────────────────────────────────────────── */
  /**
   * Sets an element's text, tolerating a missing element.
   *
   * Lets the status bar markup be trimmed without every writer needing a
   * null check.
   *
   * @param {string} id Element id.
   * @param {string} value Text to set.
   */
  function put(id, value) {
    const el = $(id);
    if (el) {
      el.textContent = value;
    }
  }

  /**
   * Refreshes the status bar counters and the word-goal bar.
   *
   * @param {string} text Current document text.
   */
  function updateStats(text) {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    put('statWords', words.toLocaleString() + (words === 1 ? ' word' : ' words'));
    put('statChars', text.length.toLocaleString() + ' chars');
    put('statRead', Math.max(1, Math.ceil(words / 200)) + ' min');

    const goal = Number(config.wordGoal) || 0;
    const wrap = $('goalWrap');
    if (goal > 0) {
      wrap.hidden = false;
      const pct = Math.min(100, (words / goal) * 100);
      put('goalLabel', words + '/' + goal);
      const fill = $('goalFill');
      fill.style.width = pct + '%';
      fill.classList.toggle('done', words >= goal);
    } else {
      wrap.hidden = true;
    }
  }

  /* ── Host <-> webview ──────────────────────────────────── */
  let editTimer = null;
  /**
   * Sends the buffer to the extension host, debounced.
   *
   * Undebounced, every keystroke becomes a separate WorkspaceEdit, which
   * makes Ctrl+Z undo one character at a time and floods the host.
   */
  function pushEdit() {
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      vscode.postMessage({ type: 'edit', text: cm.getValue() });
    }, 220);
  }

  /**
   * Applies text that came from the host.
   *
   * Caret and scroll position are restored around `setValue`, otherwise an
   * edit made in a second editor on the same file would throw the user back
   * to the top of the document.
   *
   * @param {string} text Full document text.
   */
  function setText(text) {
    if (cm.getValue() === text) {
      return;
    }
    applyingRemote = true;
    const cursor = cm.getCursor();
    const scroll = cm.getScrollInfo();
    cm.setValue(text);
    cm.setCursor(cursor);
    cm.scrollTo(scroll.left, scroll.top);
    applyingRemote = false;
    render(text);
    updateStats(text);
    if (richMode) {
      markBlockLines();
    }
  }

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg) {
      return;
    }
    if (msg.type === 'init') {
      gotInit = true;
      // Merge config first — it is plain data and cannot throw, and setText
      // reads it (wordGoal) while computing stats.
      config = Object.assign(config, msg.config || {});
      // Then content, on its own. Everything after is presentation; if any of
      // that throws, the document must still be on screen.
      setText(msg.text || '');
      try {
        applyConfig();
        setView(config.defaultView || 'split');
        if (msg.fileName) {
          $('statFile').textContent = msg.fileName;
        }
      } catch (err) {
        // Never let a styling failure look like a broken editor.
        console.error('markdown.co.in: init styling failed', err);
        setRich(false);
      }
    } else if (msg.type === 'update') {
      setText(msg.text || '');
    } else if (msg.type === 'config') {
      config = Object.assign(config, msg.config || {});
      applyConfig();
      updateStats(cm.getValue());
    }
  });

  /** Applies the current settings snapshot to the UI. */
  function applyConfig() {
    const fonts = {
      Lora: 'Lora, Georgia, serif',
      'DM Sans': 'var(--vscode-font-family)',
      'DM Mono': 'var(--vscode-editor-font-family, monospace)',
      'Editor font': 'var(--vscode-editor-font-family, monospace)',
    };
    document.documentElement.style.setProperty(
      '--md-prose-font',
      fonts[config.previewFont] || fonts.Lora,
    );
    setSync(!!config.syncScroll);
    setRich(config.richEditing !== false);
  }

  /* ── Views ─────────────────────────────────────────────── */
  let currentView = 'split';
  /**
   * Switches between editor-only, split and preview-only.
   *
   * @param {'editor'|'split'|'preview'} view Target view.
   */
  function setView(view) {
    currentView = view;
    $('editorPane').classList.toggle('hidden', view === 'preview');
    $('previewPane').classList.toggle('hidden', view === 'editor');
    $('splitter').classList.toggle('hidden', view !== 'split');
    document.querySelectorAll('.seg-btn').forEach((b) => {
      const on = b.dataset.view === view;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (view !== 'preview') {
      setTimeout(() => cm.refresh(), 0);
    }
  }

  /* ── Formatting ────────────────────────────────────────── */
  const WRAP = { bold: '**', italic: '_', strike: '~~', code: '`' };
  const PREFIX = {
    h1: '# ',
    h2: '## ',
    h3: '### ',
    ul: '- ',
    ol: '1. ',
    check: '- [ ] ',
    quote: '> ',
  };

  /**
   * Applies a formatting action to the selection or caret.
   *
   * Block prefixes replace rather than stack, so H2 on an existing H1 line
   * yields `## x` and not `# ## x`. Wrapping actions toggle off when the
   * selection is already wrapped.
   *
   * @param {string} kind Key from WRAP or PREFIX, or one of
   *   'link' | 'codeblock' | 'table'.
   */
  function applyFormat(kind) {
    if (!cm) {
      return;
    }
    cm.focus();
    const sel = cm.getSelection();

    if (WRAP[kind]) {
      const w = WRAP[kind];
      if (sel) {
        // Toggle off if the selection is already wrapped
        if (sel.startsWith(w) && sel.endsWith(w) && sel.length > w.length * 2) {
          cm.replaceSelection(sel.slice(w.length, -w.length));
        } else {
          cm.replaceSelection(w + sel + w);
        }
      } else {
        const c = cm.getCursor();
        cm.replaceRange(w + w, c);
        cm.setCursor({ line: c.line, ch: c.ch + w.length });
      }
      return;
    }

    if (PREFIX[kind]) {
      const from = cm.getCursor('from'),
        to = cm.getCursor('to');
      for (let l = from.line; l <= to.line; l++) {
        const line = cm.getLine(l);
        // Strip any existing block marker first so toggling between H1/H2/list
        // does not stack prefixes.
        const stripped = line.replace(
          /^\s*(#{1,6}\s+|[-*+]\s\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/,
          '',
        );
        const next = line === PREFIX[kind] + stripped ? stripped : PREFIX[kind] + stripped;
        cm.replaceRange(next, { line: l, ch: 0 }, { line: l, ch: line.length });
      }
      return;
    }

    if (kind === 'link') {
      const text = sel || 'link text';
      cm.replaceSelection('[' + text + '](url)');
      return;
    }
    if (kind === 'codeblock') {
      cm.replaceSelection('```\n' + (sel || '') + '\n```');
      return;
    }
    if (kind === 'table') {
      cm.replaceSelection('| Column A | Column B |\n| --- | --- |\n| Cell | Cell |\n');
      return;
    }
  }

  /* ── Block line classes for rich mode ──────────────────────
     The markdown mode hands tokenising inside a fence to the inner mode
     (js/css/xml), so no token tells us "this line is code". Scan the doc
     for fences and quote markers and tag whole lines instead. */
  let blockTimer = null;
  /**
   * Tags whole lines that belong to a block construct, debounced.
   *
   * Needed because once a fence hands tokenising to an inner mode, no token
   * says "this line is code" — only a scan of the document can tell.
   */
  function markBlockLines() {
    clearTimeout(blockTimer);
    blockTimer = setTimeout(() => {
      if (!cm) {
        return;
      }
      try {
        cm.operation(() => {
          let inFence = false;
          cm.eachLine((line) => {
            const text = line.text;
            const isFence = /^\s{0,3}(```|~~~)/.test(text);
            const isCode = inFence || isFence;
            const isQuote = !isCode && /^\s{0,3}>/.test(text);
            const isTask = !isCode && /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(text);
            toggleLineClass(line, 'md-code-line', isCode);
            toggleLineClass(line, 'md-quote-line', isQuote);
            toggleLineClass(line, 'md-task-line', isTask);
            if (isFence) {
              inFence = !inFence;
            }
          });
        });
        decorateTasks();
      } catch (err) {
        // Line decoration is cosmetic — never let it take the editor down.
        console.error('markdown.co.in: block scan failed', err);
      }
    }, 120);
  }
  /* Task list checkboxes.
     CodeMirror tokenises the "[ ]" of a task item as *link brackets*
     (cm-formatting-link), which rich mode hides — so "- [ ] thing" rendered
     as "-   thing" and "- [x] thing" as "- x thing". Rather than merely
     un-hiding the brackets, swap them for a real checkbox the user can click.
     The line under the cursor keeps its raw text, like every other marker. */
  let taskMarks = [];
  function decorateTasks() {
    // A mark whose range was already removed throws on clear(); that is
    // expected during rapid edits and means the work is already done.
    taskMarks.forEach((m) => {
      try {
        m.clear();
      } catch {
        /* mark already gone */
      }
    });
    taskMarks = [];
    if (!richMode || !cm) {
      return;
    }
    const cursorLine = cm.getCursor().line;
    const focused = cm.hasFocus();

    cm.eachLine((handle) => {
      const lineNo = cm.getLineNumber(handle);
      if (lineNo === null) {
        return;
      }
      if (focused && lineNo === cursorLine) {
        return;
      } // editing: leave it raw
      const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(handle.text);
      if (!m) {
        return;
      }

      const from = { line: lineNo, ch: m[1].length };
      const to = { line: lineNo, ch: m[1].length + 3 };
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'md-task';
      box.checked = m[2].toLowerCase() === 'x';
      box.title = 'Toggle task';
      box.addEventListener('mousedown', (e) => {
        e.preventDefault(); // don't let CodeMirror move the caret here
        e.stopPropagation();
        cm.replaceRange(box.checked ? '[ ]' : '[x]', from, to);
      });
      // handleMouseEvents defaults to false, which is what we want: the click
      // reaches our element instead of being swallowed by the editor.
      taskMarks.push(cm.markText(from, to, { replacedWith: box, atomic: false }));
    });
  }

  /**
   * Adds or removes a line class, touching only lines that actually change.
   *
   * @param {object} line CodeMirror line handle.
   * @param {string} cls Class name.
   * @param {boolean} on Desired state.
   */
  function toggleLineClass(line, cls, on) {
    // addLineClass is a no-op if already present, but removeLineClass is not
    // free, so only touch lines whose state actually changed.
    const has = (line.textClass || '').split(' ').indexOf(cls) !== -1;
    if (on && !has) {
      cm.addLineClass(line, 'text', cls);
    } else if (!on && has) {
      cm.removeLineClass(line, 'text', cls);
    }
  }

  /**
   * Turns live rendering on or off.
   *
   * Any failure here falls back to raw mode rather than propagating — a
   * broken decoration must never leave the user staring at a blank editor.
   *
   * @param {boolean} on True for rich editing.
   */
  function setRich(on) {
    try {
      richMode = on;
      $('app').classList.toggle('md-rich', on);
      const btn = $('richBtn');
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on
        ? 'Rich editing — click for raw Markdown'
        : 'Raw Markdown — click for rich editing';
      if (on) {
        markBlockLines();
      } else {
        taskMarks.forEach((m) => {
          try {
            m.clear();
          } catch {
            /* mark already gone */
          }
        });
        taskMarks = [];
      }
      if (cm) {
        cm.refresh();
      }
    } catch (err) {
      console.error('markdown.co.in: rich mode failed, falling back to raw', err);
      richMode = false;
      $('app').classList.remove('md-rich');
    }
  }

  /* ── Popovers ──────────────────────────────────────────── */
  /** Closes every open toolbar popover. */
  function closePops() {
    document.querySelectorAll('.pop.open').forEach((p) => p.classList.remove('open'));
    document
      .querySelectorAll('[aria-haspopup]')
      .forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }
  /**
   * Wires a toolbar button to its popover.
   *
   * @param {string} btnId Trigger button id.
   * @param {string} popId Popover element id.
   */
  function wirePop(btnId, popId) {
    const btn = $(btnId),
      pop = $(popId);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wasOpen = pop.classList.contains('open');
      closePops();
      if (!wasOpen) {
        pop.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
      }
    });
  }
  // click anywhere else dismisses — matches how VS Code's own menus behave
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pop-wrap')) {
      closePops();
    }
  });

  /**
   * Sets scroll-sync state and its menu checkmark.
   *
   * @param {boolean} on True to keep the panes linked.
   */
  function setSync(on) {
    config.syncScroll = !!on;
    $('syncCheck').classList.toggle('off', !on);
    $('syncItem').setAttribute('aria-checked', String(!!on));
  }

  /* ── Scroll sync ───────────────────────────────────────── */
  /**
   * Links editor and preview scrolling, proportionally.
   *
   * Approximate by nature: a tall image or code block occupies very
   * different heights in source and output, so alignment drifts around
   * them. Close enough to navigate by, not to proofread by.
   */
  function linkScroll() {
    const pv = $('previewScroll');
    cm.on('scroll', () => {
      if (!config.syncScroll || syncing || currentView !== 'split') {
        return;
      }
      const info = cm.getScrollInfo();
      const denom = Math.max(1, info.height - info.clientHeight);
      syncing = true;
      pv.scrollTop = (info.top / denom) * (pv.scrollHeight - pv.clientHeight);
      requestAnimationFrame(() => {
        syncing = false;
      });
    });
    pv.addEventListener(
      'scroll',
      () => {
        if (!config.syncScroll || syncing || currentView !== 'split') {
          return;
        }
        const denom = Math.max(1, pv.scrollHeight - pv.clientHeight);
        const info = cm.getScrollInfo();
        syncing = true;
        cm.scrollTo(0, (pv.scrollTop / denom) * (info.height - info.clientHeight));
        requestAnimationFrame(() => {
          syncing = false;
        });
      },
      { passive: true },
    );
  }

  /* ── Resizable split ───────────────────────────────────── */
  /** Makes the divider between the two panes draggable. */
  function draggableSplit() {
    const sp = $('splitter'),
      panes = $('panes'),
      ed = $('editorPane');
    let dragging = false;
    sp.addEventListener('mousedown', (e) => {
      dragging = true;
      sp.classList.add('dragging');
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) {
        return;
      }
      const r = panes.getBoundingClientRect();
      const pct = Math.min(0.85, Math.max(0.15, (e.clientX - r.left) / r.width));
      ed.style.flex = '0 0 ' + pct * 100 + '%';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) {
        return;
      }
      dragging = false;
      sp.classList.remove('dragging');
      cm.refresh();
    });
  }

  /* ── highlight.js theme follows VS Code's ──────────────── */
  /**
   * Switches the highlight.js stylesheet to match VS Code's theme.
   *
   * VS Code stamps `vscode-light` / `vscode-dark` on `<body>`, so a
   * MutationObserver on that class is how we notice a theme change.
   */
  function syncHljsTheme() {
    const light =
      document.body.classList.contains('vscode-light') ||
      document.body.classList.contains('vscode-high-contrast-light');
    $('hlLight').disabled = !light;
    $('hlDark').disabled = light;
  }

  /* ── Boot ──────────────────────────────────────────────── */
  /**
   * Boots the webview: creates the editor, wires the UI, tells the host we
   * are ready. The host replies with the document.
   */
  function init() {
    cm = CodeMirror($('cm'), {
      value: '',
      // highlightFormatting is off by default — without it the mode never emits
      // cm-formatting-* tokens, so there is nothing to hide and no way to tell
      // a "**" apart from the bold text it wraps.
      mode: { name: 'markdown', highlightFormatting: true, fencedCodeBlockHighlighting: true },
      lineNumbers: true,
      lineWrapping: true,
      autoCloseBrackets: true,
      styleActiveLine: true,
      viewportMargin: 40,
      extraKeys: {
        'Ctrl-B': () => applyFormat('bold'),
        'Cmd-B': () => applyFormat('bold'),
        'Ctrl-I': () => applyFormat('italic'),
        'Cmd-I': () => applyFormat('italic'),
        // Let VS Code own Save; just tell the host to flush the document.
        'Ctrl-S': () => vscode.postMessage({ type: 'save' }),
        'Cmd-S': () => vscode.postMessage({ type: 'save' }),
      },
    });

    let lastCursorLine = -1;
    cm.on('cursorActivity', () => {
      const l = cm.getCursor().line;
      if (l === lastCursorLine) {
        return;
      } // only when we actually change line
      lastCursorLine = l;
      if (richMode) {
        markBlockLines();
      }
    });
    cm.on('focus', () => {
      if (richMode) {
        markBlockLines();
      }
    });
    cm.on('blur', () => {
      if (richMode) {
        markBlockLines();
      }
    });

    cm.on('change', () => {
      if (applyingRemote) {
        return;
      }
      const text = cm.getValue();
      render(text);
      updateStats(text);
      if (richMode) {
        markBlockLines();
      }
      pushEdit();
    });

    document
      .querySelectorAll('.seg-btn')
      .forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    // one handler covers toolbar buttons and popover items alike
    document.querySelectorAll('[data-fmt]').forEach((b) =>
      b.addEventListener('click', () => {
        closePops();
        applyFormat(b.dataset.fmt);
      }),
    );
    document.querySelectorAll('[data-command]').forEach((b) =>
      b.addEventListener('click', () => {
        closePops();
        vscode.postMessage({ type: 'command', command: b.dataset.command });
      }),
    );

    wirePop('fmtMore', 'fmtPop');
    wirePop('moreBtn', 'morePop');

    $('syncItem').addEventListener('click', () => {
      setSync(!config.syncScroll);
      vscode.postMessage({ type: 'setConfig', key: 'syncScroll', value: config.syncScroll });
      closePops();
    });

    $('richBtn').addEventListener('click', () => {
      setRich(!richMode);
      vscode.postMessage({ type: 'setConfig', key: 'richEditing', value: richMode });
      cm.focus();
    });

    $('focusBtn').addEventListener('click', () => {
      const on = $('app').classList.toggle('focus');
      $('focusBtn').setAttribute('aria-pressed', String(on));
      cm.refresh();
      cm.focus();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') {
        return;
      }
      if (document.querySelector('.pop.open')) {
        closePops();
        return;
      }
      if ($('app').classList.contains('focus')) {
        $('app').classList.remove('focus');
        $('focusBtn').setAttribute('aria-pressed', 'false');
        cm.refresh();
        cm.focus();
      }
    });

    linkScroll();
    draggableSplit();
    syncHljsTheme();
    new MutationObserver(syncHljsTheme).observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    vscode.postMessage({ type: 'ready' });

    // If the host never replies, the panes would just sit empty with no clue
    // why. Surface it rather than looking broken.
    setTimeout(() => {
      if (gotInit) {
        return;
      }
      $('preview').innerHTML =
        '<h2>Editor did not receive the document</h2>' +
        '<p>The webview loaded but the extension host never sent its contents. ' +
        'Close this tab, run <b>Developer: Reload Window</b>, then reopen the file.</p>' +
        '<p>If it persists, run <b>Developer: Open Webview Developer Tools</b> ' +
        'and check the Console.</p>';
      $('statFile').textContent = 'not connected';
    }, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
