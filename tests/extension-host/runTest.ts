import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/**
 * Entry point for @vscode/test-electron. Downloads a VS Code binary (cached
 * across runs), launches it with our extension installed, and points it at
 * the compiled mocha suite.
 *
 * The `workspace` argument is a disposable folder that exists only so the
 * Extension Host has somewhere to open — individual tests create the
 * `.gitlab-ci.yml` documents they need via `vscode.workspace.openTextDocument`.
 */
async function main(): Promise<void> {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
    const workspace = path.resolve(extensionDevelopmentPath, 'tests', 'fixtures');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-workspace-trust',
      ],
    });
  } catch (err) {
    console.error('Extension-host test run failed:', err);
    process.exit(1);
  }
}

main();
