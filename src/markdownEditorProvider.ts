import * as vscode from 'vscode';

/**
 * A CustomTextEditorProvider — deliberately *not* CustomEditorProvider.
 *
 * The text variant hands us VS Code's own TextDocument, so undo/redo, the dirty
 * indicator, Save, Save As, hot exit, file watching and SCM diff all keep
 * working exactly as they do in the native editor. A plain CustomEditorProvider
 * would make us reimplement every one of those, badly.
 *
 * Registered with priority "option" in package.json: the native text editor
 * stays the default for .md, and this one is opt-in per file.
 */
export class MarkdownEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'markdownCoIn.editor';

  /**
   * Registers the provider with VS Code.
   *
   * `retainContextWhenHidden` costs memory but preserves scroll position,
   * undo stack and view mode when the tab is backgrounded; rebuilding the
   * webview on every tab switch is far more jarring than the memory cost.
   *
   * @param context Extension context, used to resolve media URIs.
   * @returns A disposable that unregisters the provider.
   */
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerCustomEditorProvider(
      MarkdownEditorProvider.viewType,
      new MarkdownEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: true,
      },
    );
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Builds one editor instance and wires it to its document.
   *
   * Both directions are guarded against feedback: `writingFromWebview`
   * stops our own `applyEdit` from echoing back and stomping the caret,
   * and the webview debounces before sending.
   *
   * @param document The TextDocument VS Code owns on our behalf.
   * @param panel The webview panel to populate.
   * @param _token Cancellation token; resolution is synchronous enough to
   *   ignore it.
   */
  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    panel.webview.html = this.html(panel.webview);

    // Guard against the echo loop: our own applyEdit fires onDidChangeTextDocument,
    // which would otherwise be pushed straight back into the webview and stomp
    // the user's cursor mid-keystroke.
    let writingFromWebview = false;

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      if (writingFromWebview) {
        return;
      }
      if (e.contentChanges.length === 0) {
        return;
      }
      panel.webview.postMessage({ type: 'update', text: document.getText() });
    });

    const configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('markdownCoIn')) {
        panel.webview.postMessage({ type: 'config', config: readConfig() });
      }
    });

    panel.onDidDispose(() => {
      changeSub.dispose();
      configSub.dispose();
    });

    panel.webview.onDidReceiveMessage(async (msg: any) => {
      switch (msg?.type) {
        case 'ready':
          panel.webview.postMessage({
            type: 'init',
            text: document.getText(),
            config: readConfig(),
            fileName: document.uri.path.split('/').pop(),
          });
          return;

        case 'edit': {
          if (typeof msg.text !== 'string') {
            return;
          }
          if (msg.text === document.getText()) {
            return;
          }
          writingFromWebview = true;
          try {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), msg.text);
            await vscode.workspace.applyEdit(edit);
          } finally {
            writingFromWebview = false;
          }
          return;
        }

        case 'save':
          await document.save();
          return;

        case 'command':
          // Route toolbar buttons to real VS Code commands so keybindings,
          // the palette and the toolbar all go through one path.
          if (typeof msg.command === 'string' && msg.command.startsWith('markdownCoIn.')) {
            await vscode.commands.executeCommand(msg.command);
          }
          return;

        case 'setConfig':
          if (typeof msg.key === 'string') {
            await vscode.workspace
              .getConfiguration('markdownCoIn')
              .update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
          }
          return;

        case 'info':
          vscode.window.showInformationMessage(String(msg.text ?? ''));
          return;
      }
    });
  }

  /**
   * Produces the webview document.
   *
   * Every asset is referenced through `asWebviewUri` and allowed by an
   * explicit CSP: no CDN, no inline script beyond the nonce'd tags. This is
   * why the runtime libraries are vendored into media/vendor rather than
   * fetched.
   *
   * @param webview The webview whose `cspSource` and URI scheme we target.
   * @returns A complete HTML document.
   */
  private html(webview: vscode.Webview): string {
    const media = (...p: string[]) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', ...p));

    const nonce = makeNonce();
    // Strict CSP. No CDN, no inline script except our nonce'd bootstrap, and
    // styles limited to the extension's own files plus VS Code's injected ones.
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    const v = (f: string) => media('vendor', f);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${v('codemirror.css')}">
<link rel="stylesheet" href="${v('hl-dark.css')}" id="hlDark">
<link rel="stylesheet" href="${v('hl-light.css')}" id="hlLight" disabled>
<link rel="stylesheet" href="${v('codicon.css')}">
<link rel="stylesheet" href="${media('editor.css')}">
<title>markdown.co.in</title>
</head>
<body>
<div class="app" id="app">
  <div class="toolbar" id="toolbar">
    <div class="seg" role="tablist" aria-label="View">
      <button class="seg-btn" data-view="editor" role="tab" title="Editor only">
        <i class="codicon codicon-edit"></i></button>
      <button class="seg-btn active" data-view="split" role="tab" title="Split">
        <i class="codicon codicon-split-horizontal"></i></button>
      <button class="seg-btn" data-view="preview" role="tab" title="Preview only">
        <i class="codicon codicon-preview"></i></button>
    </div>

    <span class="sep"></span>

    <div class="fmt" id="fmt">
      <button class="ibtn" data-fmt="bold" title="Bold (Ctrl+B)"><i class="codicon codicon-bold"></i></button>
      <button class="ibtn" data-fmt="italic" title="Italic (Ctrl+I)"><i class="codicon codicon-italic"></i></button>
      <button class="ibtn" data-fmt="code" title="Inline code"><i class="codicon codicon-code"></i></button>
      <span class="sep"></span>
      <button class="ibtn txt" data-fmt="h1" title="Heading 1">H1</button>
      <button class="ibtn txt" data-fmt="h2" title="Heading 2">H2</button>
      <span class="sep"></span>
      <button class="ibtn" data-fmt="ul" title="Bullet list"><i class="codicon codicon-list-unordered"></i></button>
      <button class="ibtn" data-fmt="link" title="Insert link"><i class="codicon codicon-link"></i></button>

      <div class="pop-wrap">
        <button class="ibtn" id="fmtMore" title="More formatting" aria-haspopup="true" aria-expanded="false">
          <i class="codicon codicon-ellipsis"></i></button>
        <div class="pop" id="fmtPop" role="menu">
          <button class="pop-item" data-fmt="h3" role="menuitem"><i class="codicon codicon-text-size"></i>Heading 3</button>
          <button class="pop-item" data-fmt="ol" role="menuitem"><i class="codicon codicon-list-ordered"></i>Numbered list</button>
          <button class="pop-item" data-fmt="check" role="menuitem"><i class="codicon codicon-checklist"></i>Task list</button>
          <button class="pop-item" data-fmt="quote" role="menuitem"><i class="codicon codicon-quote"></i>Blockquote</button>
          <button class="pop-item" data-fmt="table" role="menuitem"><i class="codicon codicon-table"></i>Table</button>
          <button class="pop-item" data-fmt="codeblock" role="menuitem"><i class="codicon codicon-file-code"></i>Code block</button>
          <button class="pop-item" data-fmt="strike" role="menuitem"><i class="codicon codicon-remove"></i>Strikethrough</button>
        </div>
      </div>
    </div>

    <div class="spacer"></div>

    <button class="ibtn" id="richBtn" title="Rich editing — click for raw Markdown" aria-pressed="true">
      <i class="codicon codicon-markdown"></i></button>
    <button class="ibtn" id="focusBtn" title="Focus mode"><i class="codicon codicon-screen-full"></i></button>

    <div class="pop-wrap">
      <button class="ibtn" id="moreBtn" title="More" aria-haspopup="true" aria-expanded="false">
        <i class="codicon codicon-ellipsis"></i></button>
      <div class="pop pop-right" id="morePop" role="menu">
        <button class="pop-item" id="syncItem" role="menuitemcheckbox" aria-checked="true">
          <i class="codicon codicon-check" id="syncCheck"></i>Sync scrolling</button>
        <div class="pop-sep"></div>
        <button class="pop-item" data-command="markdownCoIn.exportHtml" role="menuitem">
          <i class="codicon codicon-file-code"></i>Export as HTML</button>
        <button class="pop-item" data-command="markdownCoIn.exportPdf" role="menuitem">
          <i class="codicon codicon-file-pdf"></i>Export as PDF</button>
      </div>
    </div>
  </div>

  <div class="panes" id="panes">
    <div class="pane" id="editorPane"><div id="cm"></div></div>
    <div class="splitter" id="splitter"></div>
    <div class="pane" id="previewPane"><div class="preview-scroll" id="previewScroll">
      <div class="preview-body" id="preview"></div>
    </div></div>
  </div>

  <div class="status" id="status">
    <span id="statFile"></span>
    <span class="spacer"></span>
    <span id="statWords">0 words</span>
    <span id="statRead">0 min</span>
    <span class="goal" id="goalWrap" hidden>
      <span class="goal-bar"><i id="goalFill"></i></span>
      <span id="goalLabel"></span>
    </span>
  </div>
</div>

<script nonce="${nonce}" src="${v('codemirror.js')}"></script>
<script nonce="${nonce}" src="${v('mode-meta.js')}"></script>
<script nonce="${nonce}" src="${v('mode-xml.js')}"></script>
<script nonce="${nonce}" src="${v('mode-javascript.js')}"></script>
<script nonce="${nonce}" src="${v('mode-css.js')}"></script>
<script nonce="${nonce}" src="${v('mode-markdown.js')}"></script>
<script nonce="${nonce}" src="${v('addon-closebrackets.js')}"></script>
<script nonce="${nonce}" src="${v('addon-active-line.js')}"></script>
<script nonce="${nonce}" src="${v('marked.js')}"></script>
<script nonce="${nonce}" src="${v('purify.js')}"></script>
<script nonce="${nonce}" src="${v('highlight.js')}"></script>
<script nonce="${nonce}" src="${media('editor.js')}"></script>
</body>
</html>`;
  }
}

/**
 * Snapshots the `markdownCoIn.*` settings for the webview.
 *
 * Sent on init and again whenever the user changes a setting, so the
 * webview never reads configuration itself.
 *
 * @returns A plain, structured-cloneable settings object.
 */
function readConfig() {
  const c = vscode.workspace.getConfiguration('markdownCoIn');
  return {
    defaultView: c.get<string>('defaultView', 'split'),
    previewFont: c.get<string>('previewFont', 'Lora'),
    wordGoal: c.get<number>('wordGoal', 0),
    syncScroll: c.get<boolean>('syncScroll', true),
    richEditing: c.get<boolean>('richEditing', true),
  };
}

/**
 * Generates a one-off nonce for the CSP `script-src`.
 *
 * A fresh value per webview means an injected `<script>` cannot carry a
 * valid nonce and will be refused by the browser.
 *
 * @returns 32 random alphanumeric characters.
 */
function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
