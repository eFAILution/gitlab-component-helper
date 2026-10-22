/**
 * Build config for the standalone MCP server bundle (`out/mcp/server.js`). Shared by esbuild.js and the spawn test.
 */
const pkg = require('./package.json');

/**
 * Fails the build on any `vscode` import: the server runs under plain Node, where `vscode` doesn't exist.
 *
 * @type {import('esbuild').Plugin}
 */
const noVscodePlugin = {
  name: 'no-vscode',
  setup(build) {
    build.onResolve({ filter: /^vscode$/ }, (args) => ({
      errors: [{ text: `The MCP server must not import vscode (imported by ${args.importer})` }],
    }));
  },
};

/**
 * @param {{ production?: boolean, outfile?: string }} [options]
 * @returns {import('esbuild').BuildOptions}
 */
function mcpConfig({ production = false, outfile = 'out/mcp/server.js' } = {}) {
  return {
    entryPoints: ['src/mcp/main.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node22',
    // Prefer ESM builds: jsonc-parser's UMD build requires its own files at runtime, which a bundle can't satisfy.
    mainFields: ['module', 'main'],
    outfile,
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    banner: { js: '#!/usr/bin/env node' },
    define: { GCH_VERSION: JSON.stringify(pkg.version) },
    logLevel: 'silent',
    plugins: [noVscodePlugin],
  };
}

module.exports = { mcpConfig, noVscodePlugin };
