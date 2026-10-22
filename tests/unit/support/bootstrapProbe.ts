/**
 * Child-process probe for bootstrap tests (bootstrap locks the runtime, so it can't run in the mocha process).
 * argv: <env JSON> <root> <cache dir> <comma-separated hosts>. Prints one JSON line to stdout.
 */
import { bootstrap } from '../../../src/mcp/bootstrap';
import { getRuntime } from '../../../src/core/runtime';

(async () => {
  const env: NodeJS.ProcessEnv = JSON.parse(process.argv[2]);
  const context = await bootstrap(['--root', process.argv[3], '--cache-dir', process.argv[4]], env, process.cwd());
  const hosts: Record<string, unknown> = {};
  for (const host of process.argv[5].split(',')) {
    hosts[host] = { token: (await getRuntime().secrets.get(`gitlab-token-${host}`)) ?? null, allowed: context.isHostAllowed(host) };
  }
  const envLeft = Object.keys(env).filter((name) => name.startsWith('GCH_TOKEN') || name === 'GITLAB_TOKEN');
  process.stdout.write(`${JSON.stringify({ hosts, envLeft })}\n`);
})();
