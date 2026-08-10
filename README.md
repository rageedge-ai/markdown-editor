# Markdown Editor by RageEdge

[![Visual Studio Marketplace Version](https://img.shields.io/visual-studio-marketplace/v/rageedge-ai.markdown-editor?color=c6f135&label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=rageedge-ai.markdown-editor)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/rageedge-ai.markdown-editor?color=3f6212)](https://marketplace.visualstudio.com/items?itemName=rageedge-ai.markdown-editor)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/rageedge-ai.markdown-editor)](https://marketplace.visualstudio.com/items?itemName=rageedge-ai.markdown-editor&ssr=false#review-details)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/rageedge-ai/markdown-editor/blob/main/LICENSE)

Developed by **[RageEdge AI](https://rageedge.ai)** · Hosted at **[markdown.co.in](https://markdown.co.in)**

A rich Markdown editing surface for VS Code: live split preview, focus mode, word goals, and one-click export to HTML or PDF.

It is **opt-in**. VS Code's native text editor stays the default for `.md`; this one opens only when you ask for it.

---

## Opening it

Any of these:

- **`Ctrl+Shift+M`** (`Cmd+Shift+M` on macOS) with a Markdown file open
- Right-click a `.md` file in the Explorer → **Open in markdown.co.in Editor**
- Command Palette → **Markdown: Open in markdown.co.in Editor**
- The editor title-bar button

To make it the default for every `.md` file: right-click a file → **Open With…** → **Configure default editor for `*.md`**.

---

## What it does

**Live (rich) editing.** Markdown renders as you type rather than sitting there as raw source. It works on two levels:

- the line your **cursor is on** shows its raw syntax, so you can edit it
- **every other line** renders, so `## Heading` is a large heading and `**bold**` is bold
- **blur the editor** and the markers disappear entirely, so the whole document reads as finished text

Headings scale, bold and italic are real, inline code gets a chip, fenced blocks become a monospace slab and blockquotes get a left rule. The characters are only _hidden_, never removed, so selection, find and the saved file are untouched. Click **Raw** in the toolbar (or set `markdownCoIn.richEditing` to false) for plain source editing.

**Live split preview.** Editor and rendered output side by side, with optional synced scrolling and a draggable divider. Switch to editor-only or preview-only from the toolbar.

**Focus mode.** Hides the toolbar, status bar and gutter, and enlarges the type. `Esc` returns.

**Word goals.** Set `markdownCoIn.wordGoal` and the status bar shows a progress bar alongside live word, character and reading-time counts.

**Formatting toolbar.** Bold, italic, strikethrough, inline code, H1–H3, bullet / numbered / task lists, links, tables, code blocks and blockquotes. Block prefixes toggle rather than stack, so clicking H2 on an H1 line replaces the marker instead of producing `# ## `.

**Export.** _Export as HTML_ writes a single self-contained file, with no CDN and no external stylesheet. _Export as PDF_ opens the styled document in your browser with the print dialog ready, with print rules that avoid breaking inside code blocks and tables.

**GitHub Flavored Markdown.** Tables, task lists, strikethrough, and fenced code with syntax highlighting for ~40 common languages.

---

## It follows your theme

Every colour comes from VS Code's own theme variables, so the editor and preview match whatever theme you run, including high-contrast ones. Nothing is hardcoded.

---

## Settings

| Setting                    | Default | What it does                                                           |
| -------------------------- | ------- | ---------------------------------------------------------------------- |
| `markdownCoIn.richEditing` | `true`  | Render Markdown live while editing; the cursor's line shows raw syntax |
| `markdownCoIn.defaultView` | `split` | View the editor opens in: `editor`, `split` or `preview`               |
| `markdownCoIn.previewFont` | `Lora`  | Preview typeface: `Lora`, `DM Sans`, `DM Mono` or `Editor font`        |
| `markdownCoIn.wordGoal`    | `0`     | Word-count target; `0` hides the progress bar                          |
| `markdownCoIn.syncScroll`  | `true`  | Keep the two panes scrolled together                                   |

---

## How it behaves with VS Code

It is built on `CustomTextEditorProvider`, which means VS Code keeps ownership of the document. Undo and redo, the dirty dot, Save, Save As, hot exit, file watching and Source Control diff all work exactly as they do in the native editor. Edits are debounced so undo stays at a sensible granularity rather than one step per keystroke.

Open the same file in both this editor and the native one and they stay in sync. Edit in either, and both update.

### Known limitations

- This is a webview, so VS Code editing features that live in the native text editor (multi-cursor, snippets, other extensions' completions, Vim keybindings) are **not** available inside it. That is why it ships as opt-in rather than replacing the default editor. For heavy code-adjacent editing, use the native editor; for drafting prose, use this one.
- Export as PDF hands off to your browser's print dialog. VS Code has no printing API, and bundling a headless browser would add hundreds of megabytes to the extension.
- Images with relative paths render in the preview only if they resolve from the workspace root.

---

## Privacy

The extension makes no network requests. Parsing, rendering, highlighting and export all run locally inside the webview. Your documents never leave your machine.

---

## Also try markdown.co.in

The same editor runs free in your browser at **[markdown.co.in](https://markdown.co.in)**, with live preview, rendered side-by-side compare with diff, focus mode and export. No install, no account, nothing uploaded.

Useful when you are away from your own machine, or want to send someone a rendered document without asking them to install anything.

---

## Credits

- **Author:** Jitendra Balla
- **Developed by:** [RageEdge AI](https://rageedge.ai)
- **Hosted at:** [markdown.co.in](https://markdown.co.in)
- **Source:** [github.com/rageedge-ai/markdown-editor](https://github.com/rageedge-ai/markdown-editor)

Issues and feature requests are welcome on the [issue tracker](https://github.com/rageedge-ai/markdown-editor/issues).

Built on [CodeMirror](https://codemirror.net/5/), [marked](https://marked.js.org/), [DOMPurify](https://github.com/cure53/DOMPurify), [highlight.js](https://highlightjs.org/) and [Codicons](https://github.com/microsoft/vscode-codicons).

---

## License

[MIT](https://github.com/rageedge-ai/markdown-editor/blob/main/LICENSE) © 2026 Jitendra Balla, RageEdge AI
