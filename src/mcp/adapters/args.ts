/**
 * Command-line options of the MCP server.
 */

export interface ServerArgs {
  /** Workspace roots the server may read; defaults to the working directory. */
  roots: string[];
  cacheDir?: string;
  logLevel?: string;
  /** Settings as a JSON object, keyed without the `gitlabComponentHelper.` prefix. */
  configJson?: string;
}

export const USAGE = `Usage: server.js [--root <dir>]... [--cache-dir <dir>] [--log-level DEBUG|INFO|WARN|ERROR] [--config <json>]

Speaks the Model Context Protocol over stdio.
  --root <dir>       A workspace root the tools may read (repeatable; default: the current directory)
  --cache-dir <dir>  Where to keep the component cache (default: GCH_CACHE_DIR or ~/.cache/gitlab-component-helper/mcp)
  --log-level <lvl>  Log level for stderr (default: GCH_LOG_LEVEL or the logLevel setting)
  --config <json>    Settings, e.g. '{"componentSources":[...]}'; overrides GCH_CONFIG_JSON and workspace files
Tokens come from GCH_TOKEN_<HOST> (e.g. GCH_TOKEN_GITLAB_COM) or GITLAB_TOKEN.`;

export class ArgsError extends Error {}

const VALUE_FLAGS = new Set(['--root', '--cache-dir', '--log-level', '--config']);

export function parseArgs(argv: readonly string[], cwd: string): ServerArgs {
  const roots: string[] = [];
  const parsed: ServerArgs = { roots };
  for (let index = 0; index < argv.length; index++) {
    const [flag, inline] = argv[index].split(/=(.*)/s, 2);
    if (!VALUE_FLAGS.has(flag)) {
      throw new ArgsError(`Unknown option: ${argv[index]}`);
    }
    const value = inline ?? argv[++index];
    if (value === undefined || value === '') {
      throw new ArgsError(`${flag} needs a value`);
    }
    if (flag === '--root') roots.push(value);
    if (flag === '--cache-dir') parsed.cacheDir = value;
    if (flag === '--log-level') parsed.logLevel = value;
    if (flag === '--config') parsed.configJson = value;
  }
  if (roots.length === 0) roots.push(cwd);
  return parsed;
}
