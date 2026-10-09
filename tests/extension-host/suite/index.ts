import * as fs from 'fs';
import { SourceMap } from 'module';
import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

// The extension host formats stacks itself, ignoring source maps, so a failure's stack names the compiled files in
// out-test. Those frames are rewritten to the TypeScript lines they were built from, which reporters then show.
function mapStack(stack: string): string {
  return stack.replace(
    /out-test[\\/]suite[\\/]([^:()\s]+?)\.js:(\d+):(\d+)/g,
    (frame, name: string, line: string, column: string) => {
      const sourceMap = new SourceMap(
        JSON.parse(fs.readFileSync(path.join(__dirname, `${name}.js.map`), 'utf8'))
      );
      const entry = sourceMap.findEntry(Number(line) - 1, Number(column) - 1);
      if (!('originalLine' in entry)) return frame;
      const source = `tests/extension-host/suite/${name.split(path.sep).join('/')}.ts`;
      return `${source}:${entry.originalLine + 1}:${entry.originalColumn + 1}`;
    }
  );
}

export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd', // tests use suite/test globals
    color: true,
    timeout: 20_000,
    // On GitHub Actions, failures are also reported as annotations on the lines in their stacks.
    reporter: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'spec',
  });

  const testsRoot = __dirname;
  const files = await glob('**/*.test.js', { cwd: testsRoot });
  files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

  return new Promise((resolve, reject) => {
    try {
      const runner = mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} test(s) failed.`));
        } else {
          resolve();
        }
      });
      // Reporters read a failure's stack when they print it, after the test run ends.
      runner.on('fail', (_test, err: Error) => {
        if (err.stack) err.stack = mapStack(err.stack);
      });
    } catch (err) {
      reject(err as Error);
    }
  });
}
