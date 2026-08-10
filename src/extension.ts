import * as vscode from 'vscode';
import * as os from 'os';
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
      // without shipping one, so write the HTML and let the OS browser print it.
      const target = vscode.Uri.joinPath(
        vscode.Uri.file(os.tmpdir()),
        `${titleOf(doc.uri)}-print.html`,
      );
      const html = renderStandaloneHtml(doc.getText(), titleOf(doc.uri), true);
      await vscode.workspace.fs.writeFile(target, Buffer.from(html, 'utf8'));
      await vscode.env.openExternal(target);
      vscode.window.showInformationMessage(
        'Opened in your browser — use its Print dialog and choose "Save as PDF".',
      );
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
