const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

/**
 * Build config for the Node-side extension bundle.
 */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  outfile: 'out/extension.js',
  external: ['vscode'],
  logLevel: 'silent',
  // Additional optimizations
  treeShaking: true,
  metafile: production,
  // Drop console logs in production for smaller bundle
  drop: production ? ['console', 'debugger'] : [],
  plugins: [
    /* add to the end of plugins array */
    esbuildProblemMatcherPlugin,
  ],
};

/**
 * Build config for webview assets (styles, and client scripts as they are
 * added). These run in the browser-like webview context, not Node, so they
 * build separately and emit under out/webview for asWebviewUri loading.
 */
const webviewConfig = {
  entryPoints: ['src/webview/styles/loading.css'],
  bundle: true,
  minify: production,
  sourcemap: !production,
  platform: 'browser',
  outdir: 'out/webview',
  // Preserve the src/webview/* folder structure (styles/, client/) under the
  // output dir so asset URIs resolve to the same sub-path as the source.
  outbase: 'src/webview',
  logLevel: 'silent',
  plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
  const ctx = await esbuild.context(extensionConfig);
  const webviewCtx = await esbuild.context(webviewConfig);
  if (watch) {
    await Promise.all([ctx.watch(), webviewCtx.watch()]);
  } else {
    await Promise.all([ctx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([ctx.dispose(), webviewCtx.dispose()]);
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
