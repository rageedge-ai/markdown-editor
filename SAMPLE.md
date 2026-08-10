# Sample document

Open this file, then press `Ctrl+Shift+M` to switch into the
**markdown.co.in Editor**. Try each thing below.

# Things to check
- [ ] abc 
- [ ] Split view renders as you type
- [ ] Drag the divider between the two panes
- [ ] Scroll one pane — the other follows (toggle **Sync** off to stop it)
- [ ] Select a word and hit the **B** button, or `Ctrl+B`
- [ ] Put the cursor on a line and click **H1**, then **H2** — the marker should
      *replace*, not stack up as `# ##`
- [ ] Click **Focus**, then press `Esc` to come back
- [x] Click **HTML** to export, and **PDF** to open the print dialog
- [ ] Switch your VS Code colour theme — this editor should follow it

## Formatting it handles

Regular text with **bold**, _italic_, ~~strikethrough~~ and `inline code`.

> A blockquote, for checking that the left border and background
> pick up your theme's colours.

| Feature | Works |
| --- | --- |
| Tables | yes |
| Task lists | yes |
| Syntax highlighting | yes |

```js
// Fenced code should be highlighted, and the language
// tag should appear in the top-right of the block.
function greet(name) {
  return `Hello, ${name}`;
}
```

```python
def greet(name):
    return f"Hello, {name}"
```

## Round-tripping

Open this same file in the **native** editor at the same time
(right-click the tab → *Split Right*, then reopen one side with the
default editor). Type in either one — both should stay in sync, and
`Ctrl+Z` should undo sensibly rather than one character at a time.
