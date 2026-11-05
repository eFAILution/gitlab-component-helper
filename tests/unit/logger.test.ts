// @mocha
/**
 * `Logger` must run under plain Node and write only to the runtime's log sink, never to stdout: the MCP server
 * uses stdout for protocol messages.
 */

import * as assert from 'node:assert/strict';
import { Logger } from '../../src/utils/logger';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

suite('Logger', () => {
  const logger = Logger.getInstance();

  // Put the singleton back on the default level, quietly, so later suites don't inherit DEBUG.
  teardown(() => {
    installFakeRuntime();
    logger.reloadLogLevel();
    restoreRuntime();
  });

  test('reloadLogLevel reads logLevel from the runtime config and reports it to the sink', () => {
    const fake = installFakeRuntime({ logLevel: 'warn' });

    logger.reloadLogLevel();

    assert.deepStrictEqual(fake.configReads, ['logLevel', 'autoShowOutput']);
    assert.equal(
      fake.lines[0],
      '[Logger] Log level updated to: warn (normalized: WARN, actual: WARN, numeric: 2)',
    );
  });

  test('writes formatted lines at or above the level, tagged with their level', () => {
    const fake = installFakeRuntime({ logLevel: 'INFO' });
    logger.reloadLogLevel();
    fake.lines.length = 0;
    fake.levels.length = 0;

    logger.debug('hidden', 'Test');
    logger.info('shown', 'Test');
    logger.error('broke', 'Test');

    assert.equal(fake.lines.length, 2);
    assert.match(fake.lines[0], /^\[\d{4}-\d\d-\d\dT[^\]]+\] \[INFO\] \[Test\] shown$/);
    assert.match(fake.lines[1], /\[ERROR\] \[Test\] broke$/);
    assert.deepStrictEqual(fake.levels, ['INFO', 'ERROR']);
  });

  test('time/timeEnd report the elapsed time through the sink at DEBUG', () => {
    const fake = installFakeRuntime({ logLevel: 'DEBUG' });
    logger.reloadLogLevel();
    fake.lines.length = 0;

    logger.time('fetch');
    logger.timeEnd('fetch');

    assert.equal(fake.lines.length, 1);
    assert.match(fake.lines[0], /\[DEBUG\] \[ComponentService\] fetch: \d+\.\d{3}ms$/);
  });

  test('time/timeEnd stay silent above DEBUG', () => {
    const fake = installFakeRuntime({ logLevel: 'ERROR' });
    logger.reloadLogLevel();
    fake.lines.length = 0;

    logger.time('fetch');
    logger.timeEnd('fetch');

    assert.deepStrictEqual(fake.lines, []);
  });

  test('showOutput is a no-op when the sink has no UI', () => {
    installFakeRuntime();
    assert.doesNotThrow(() => logger.showOutput());
  });
});
