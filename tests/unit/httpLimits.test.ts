// @mocha
/**
 * HttpClient limits shared by the extension and the MCP server: a response size cap, an overall deadline, clamped
 * timeout and retry settings, and no retries for requests the network policy refuses. `https.request` is replaced
 * with a fake, so nothing leaves the process.
 */

import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { HttpClient, MAX_RESPONSE_BYTES } from '../../src/utils/httpClient';
import { RequestRefusedError } from '../../src/core/ports';
import { installFakeRuntime, restoreRuntime } from './support/fakeRuntime';

const https: typeof import('node:https') = createRequire(__filename)('node:https');
const CHUNK_BYTES = 1024 * 1024;
const SERVER_ERROR = 500;

interface FakeRequest extends EventEmitter {
  options: Record<string, unknown>;
  destroyed: boolean;
}

type Respond = (request: FakeRequest, callback: (response: EventEmitter) => void) => void;

function response(statusCode: number): EventEmitter & { statusCode: number; headers: Record<string, string>; resume(): void } {
  return Object.assign(new EventEmitter(), { statusCode, headers: {}, resume: () => undefined });
}

suite('HttpClient limits', function () {
  this.timeout(15000);
  const original = https.request;
  let requests: FakeRequest[] = [];

  function respondWith(respond: Respond): void {
    https.request = ((options: Record<string, unknown>, callback: (response: EventEmitter) => void) => {
      const request = Object.assign(new EventEmitter(), { options, destroyed: false }) as FakeRequest;
      Object.assign(request, {
        end: () => setImmediate(() => respond(request, callback)),
        destroy: () => {
          request.destroyed = true;
        },
      });
      requests.push(request);
      return request;
    }) as unknown as typeof https.request;
  }

  setup(() => {
    requests = [];
    installFakeRuntime({ httpTimeout: 1000, retryAttempts: 0 });
  });
  teardown(() => {
    https.request = original;
    restoreRuntime();
  });

  test('aborts a response body over the cap', async () => {
    respondWith((request, callback) => {
      const res = response(200);
      callback(res);
      for (let sent = 0; sent <= MAX_RESPONSE_BYTES && !request.destroyed; sent += CHUNK_BYTES) res.emit('data', Buffer.alloc(CHUNK_BYTES, 'a'));
    });

    await assert.rejects(new HttpClient().fetchText('https://gitlab.com/big'), /too large/);
    assert.equal(requests[0].destroyed, true);
  });

  test('gives up at the overall deadline even if the socket keeps trickling', async () => {
    respondWith((request, callback) => {
      const res = response(200);
      callback(res);
      const timer = setInterval(() => (request.destroyed ? clearInterval(timer) : res.emit('data', 'x')), 100);
    });
    const started = Date.now();

    await assert.rejects(new HttpClient().fetchText('https://gitlab.com/slow'), /deadline/);
    assert.ok(Date.now() - started < 10000);
    assert.equal(requests[0].destroyed, true);
  });

  test('clamps httpTimeout to 1-60s and retryAttempts to 0-5', async () => {
    installFakeRuntime({ httpTimeout: 9_999_999, retryAttempts: 99 });
    respondWith((_request, callback) => {
      const res = response(SERVER_ERROR);
      callback(res);
      res.emit('end');
    });

    await assert.rejects(new HttpClient().fetchText('https://gitlab.com/flaky', { retryDelay: 1 }));
    assert.equal(requests.length, 6);
    assert.equal(requests[0].options.timeout, 60000);

    installFakeRuntime({ httpTimeout: 5, retryAttempts: -3 });
    requests = [];
    await assert.rejects(new HttpClient().fetchText('https://gitlab.com/flaky2', { retryDelay: 1 }));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.timeout, 1000);
  });

  test('does not retry a request the network policy refused', async () => {
    let checks = 0;
    installFakeRuntime(
      { retryAttempts: 3 },
      {
        network: {
          checkRequest: () => {
            checks++;
            throw new RequestRefusedError('not allowed');
          },
        },
      }
    );
    respondWith(() => assert.fail('no request should be sent'));
    const started = Date.now();

    await assert.rejects(new HttpClient().fetchText('https://evil.example/x'), /not allowed/);
    assert.equal(checks, 1);
    assert.ok(Date.now() - started < 1000);
  });
});
