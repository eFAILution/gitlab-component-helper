const esbuild = require('esbuild');
const fs = require('fs');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Emits the `[watch] build started`/`finished` markers VS Code's background problem matcher keys on.
 *
 * Only one context may emit them: the matcher treats the first `finished` as "task ready", so a second pair from a
 * parallel build would mark the task ready while that build is still running. {@link errorReporterPlugin} covers the
 * other contexts.
 *
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',

  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      reportErrors(result);
      console.log('[watch] build finished');
    });
  },
};

/**
 * Reports build errors without emitting watch markers, for contexts that build alongside the marker-emitting one.
 *
 * @param {string} label Which build the errors came from, since the output is interleaved.
 * @returns {import('esbuild').Plugin}
 */
const errorReporterPlugin = (label) => ({
  name: `esbuild-error-reporter-${label}`,

  setup(build) {
    build.onEnd((result) => reportErrors(result, label));
  },
});

/** @param {import('esbuild').BuildResult} result @param {string} [label] */
function reportErrors(result, label) {
  const prefix = label ? `✘ [ERROR] [${label}] ` : '✘ [ERROR] ';
  result.errors.forEach(({ text, location }) => {
    console.error(`${prefix}${text}`);
    if (location) {
      console.error(`    ${location.file}:${location.line}:${location.column}:`);
    }
  });
}

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
 * Every webview asset to build, discovered rather than listed.
 *
 * A stylesheet missing from a hand-maintained list still lints and typechecks, the build still exits 0, and the
 * `<link>` only 404s once the extension is packaged. Discovery keeps the build in step with the directory.
 *
 * Only the top level of each directory is collected, so shared modules imported by a client script are bundled into
 * it rather than becoming entry points of their own. Directories that don't exist yet (`client/`, until scripts are
 * extracted) contribute nothing.
 *
 * @returns {string[]} Paths of every asset entry point, relative to the repo root.
 */
function webviewEntryPoints() {
  const assetDirs = [
    { dir: 'src/webview/styles', ext: '.css' },
    { dir: 'src/webview/client', ext: '.ts' },
  ];

  return assetDirs.flatMap(({ dir, ext }) => {
    if (!fs.existsSync(dir)) {
      return [];
    }
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
      .map((entry) => `${dir}/${entry.name}`);
  });
}

/**
 * Build config for webview assets (styles, and client scripts as they are
 * added). These run in the browser-like webview context, not Node, so they
 * build separately and emit under out/webview for asWebviewUri loading.
 */
const webviewConfig = {
  entryPoints: webviewEntryPoints(),
  bundle: true,
  minify: production,
  sourcemap: !production,
  platform: 'browser',
  // Pin the syntax level: webview assets run in the Electron renderer, not Node, so they must not inherit
  // esbuild's `esnext` default.
  target: ['es2020'],
  format: 'iife',
  outdir: 'out/webview',
  // Preserve the src/webview/* folder structure (styles/, client/) under the
  // output dir so asset URIs resolve to the same sub-path as the source.
  outbase: 'src/webview',
  logLevel: 'silent',
  plugins: [errorReporterPlugin('webview')],
};

async function main() {
  // Clear stale output: esbuild never removes files, so a renamed or deleted asset would leave a copy behind that
  // still resolves through asWebviewUri — masking a broken reference until the extension is packaged.
  fs.rmSync(webviewConfig.outdir, { recursive: true, force: true });

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
