import * as vscode from 'vscode';
import { MarkdownEditorProvider } from './markdownEditorProvider';
import { renderStandaloneHtml } from './render';

/**
 * Extension entry point.
 *
 * Registers the custom editor and the three commands. There are no
 * `activationEvents` in package.json — contributing a `customEditors` entry
 * makes VS Code activate us implicitly the first time one is opened, which
 * keeps startup cost at zero for users who never open Markdown.
 *
 * @param context Extension context; every disposable is pushed onto it so
 *   VS Code tears them down on deactivate.
 */
export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(MarkdownEditorProvider.register(context));

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownCoIn.openWith', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showInformationMessage('Open a Markdown file first.');
        return;
      }
      await vscode.commands.executeCommand(
        'vscode.openWith',
        target,
        MarkdownEditorProvider.viewType,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownCoIn.exportHtml', async () => {
      const doc = await currentMarkdown();
      if (!doc) {
        return;
      }
      const target = await vscode.window.showSaveDialog({
        filters: { HTML: ['html'] },
        defaultUri: withExtension(doc.uri, '.html'),
      });
      if (!target) {
        return;
      }
      const html = renderStandaloneHtml(doc.getText(), titleOf(doc.uri));
      await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
      const open = await vscode.window.showInformationMessage(
        `Exported ${basename(target)}`,
        'Open',
      );
      if (open) {
        await vscode.commands.executeCommand('vscode.open', target);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markdownCoIn.exportPdf', async () => {
      const doc = await currentMarkdown();
      if (!doc) {
        return;
      }
      // VS Code has no print API and extensions cannot drive a headless browser
      // without shipping one, so we write print-styled HTML and let the user
      // print it from their browser.
      //
      // Writing to a path the user picked, with no embedded script, is
      // deliberate. The earlier version dropped auto-executing HTML into
      // os.tmpdir() and launched it, which is structurally indistinguishable
      // from a dropper and is the kind of thing an automated scanner flags.
      const target = await vscode.window.showSaveDialog({
        filters: { HTML: ['html'] },
        defaultUri: withExtension(doc.uri, '.print.html'),
        title: 'Save print-ready HTML (then print it from your browser)',
      });
      if (!target) {
        return;
      }
      const html = renderStandaloneHtml(doc.getText(), titleOf(doc.uri));
      await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
      const reveal = await vscode.window.showInformationMessage(
        `Saved ${basename(target)}. Open it in your browser and print to PDF.`,
        'Reveal in Explorer',
      );
      if (reveal) {
        await vscode.commands.executeCommand('revealFileInOS', target);
      }
    }),
  );
}

/**
 * Resolves the Markdown document the user means "right now".
 *
 * `activeTextEditor` is undefined while our webview has focus, because a
 * webview is not a text editor. So when that misses we fall back to the
 * active tab's own URI, which works for both the native and custom editors.
 *
 * @returns The document, or undefined after warning the user.
 */
async function currentMarkdown(): Promise<vscode.TextDocument | undefined> {
  const active = vscode.window.activeTextEditor?.document;
  if (active && active.languageId === 'markdown') {
    return active;
  }

  // The custom editor is a webview, so activeTextEditor is undefined while it
  // has focus. Fall back to the tab's own URI.
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input: any = tab?.input;
  const uri: vscode.Uri | undefined = input?.uri;
  if (uri && /\.(md|markdown)$/i.test(uri.path)) {
    return vscode.workspace.openTextDocument(uri);
  }
  vscode.window.showInformationMessage('No Markdown file is active.');
  return undefined;
}

const basename = (u: vscode.Uri) => u.path.split('/').pop() || 'document';
const titleOf = (u: vscode.Uri) => basename(u).replace(/\.(md|markdown)$/i, '');
const withExtension = (u: vscode.Uri, ext: string) =>
  u.with({ path: u.path.replace(/\.(md|markdown)$/i, '') + ext });

/**
 * Called on shutdown. Nothing to do — every disposable was registered on
 * the extension context and is released automatically.
 */
export function deactivate() {
  /* nothing to tear down */
}
