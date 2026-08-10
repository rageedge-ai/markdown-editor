/*
 * Copies the webview's third-party runtime out of node_modules into media/vendor.
 *
 * The web build loads these from a CDN. A VS Code webview cannot: it runs under
 * a strict Content-Security-Policy that only allows the extension's own origin,
 * and extensions are expected to work offline. So everything ships in the .vsix.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'media', 'vendor');
fs.mkdirSync(OUT, { recursive: true });

const COPY = [
  ['codemirror/lib/codemirror.js', 'codemirror.js'],
  ['codemirror/lib/codemirror.css', 'codemirror.css'],
  ['codemirror/mode/markdown/markdown.js', 'mode-markdown.js'],
  ['codemirror/mode/xml/xml.js', 'mode-xml.js'],
  ['codemirror/mode/javascript/javascript.js', 'mode-javascript.js'],
  ['codemirror/mode/css/css.js', 'mode-css.js'],
  ['codemirror/mode/meta.js', 'mode-meta.js'],
  ['codemirror/addon/edit/closebrackets.js', 'addon-closebrackets.js'],
  ['codemirror/addon/search/searchcursor.js', 'addon-searchcursor.js'],
  ['codemirror/addon/selection/active-line.js', 'addon-active-line.js'],
  ['marked/marked.min.js', 'marked.js'],
  ['dompurify/dist/purify.min.js', 'purify.js'],
  // VS Code's official icon font. Using emoji or HTML entities instead is the
  // clearest visual tell of a non-native extension.
  ['@vscode/codicons/dist/codicon.css', 'codicon.css'],
  ['@vscode/codicons/dist/codicon.ttf', 'codicon.ttf'],
];

const missing = [];
for (const [src, dest] of COPY) {
  const from = path.join(ROOT, 'node_modules', src);
  if (!fs.existsSync(from)) {
    missing.push(src);
    continue;
  }
  if (!dest) {
    continue;
  }
  fs.copyFileSync(from, path.join(OUT, dest));
  console.log('  ' + dest.padEnd(26) + (fs.statSync(from).size / 1024).toFixed(1) + ' KB');
}

// highlight.js publishes no browser bundle to npm (CDN only), so build an
// IIFE that exposes window.hljs with the ~40 common languages.
const hljs = path.join(ROOT, 'node_modules', 'highlight.js');
if (fs.existsSync(hljs)) {
  require('esbuild').buildSync({
    stdin: {
      contents: "import hljs from 'highlight.js/lib/common'; window.hljs = hljs;",
      resolveDir: ROOT,
      loader: 'js',
    },
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    outfile: path.join(OUT, 'highlight.js'),
  });
  console.log(
    '  highlight.js               ' +
      (fs.statSync(path.join(OUT, 'highlight.js')).size / 1024).toFixed(1) +
      ' KB (esbuild)',
  );
  for (const [t, d] of [
    ['github.min.css', 'hl-light.css'],
    ['github-dark.min.css', 'hl-dark.css'],
  ]) {
    const p = path.join(hljs, 'styles', t);
    if (fs.existsSync(p)) {
      fs.copyFileSync(p, path.join(OUT, d));
      console.log('  ' + d);
    } else {
      missing.push('styles/' + t);
    }
  }
} else {
  missing.push('highlight.js');
}

if (missing.length) {
  console.error('\nMISSING:\n  ' + missing.join('\n  '));
  process.exit(1);
}
console.log('\nvendored -> media/vendor');
