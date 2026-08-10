# Changelog

All notable changes to this extension are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.0.1] - 2026-08-10

### Added
- Live ("rich") editing: the cursor's line shows raw Markdown, every other line
  renders, and blurring the editor hides all syntax markers. Headings scale,
  bold/italic are real, inline code gets a chip, fenced blocks become a
  monospace slab, blockquotes get a left rule. Toggle with the Raw button or
  `markdownCoIn.richEditing`. Markers are hidden, never removed — the document
  on disk is unchanged.
- Opt-in custom editor for `.md` and `.markdown`, built on `CustomTextEditorProvider`
  so undo/redo, dirty state, Save and Source Control integration keep working.
- Live split preview with synced scrolling and a draggable divider;
  editor-only and preview-only views.
- Formatting toolbar — bold, italic, strikethrough, inline code, H1–H3,
  bullet / numbered / task lists, links, tables, code blocks, blockquotes.
  Block prefixes toggle instead of stacking.
- Focus mode (`Esc` to exit) and a status bar with live word, character and
  reading-time counts plus an optional word-goal progress bar.
- Export as HTML — a single self-contained file with no external references.
- Export as PDF via the browser print dialog, with print-specific CSS.
- GitHub Flavored Markdown: tables, task lists, strikethrough, and fenced code
  highlighting for ~40 common languages.
- Theming driven entirely by VS Code theme variables, including high contrast.
- Settings: `defaultView`, `previewFont`, `wordGoal`, `syncScroll`.
