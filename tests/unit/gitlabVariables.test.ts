// @mocha
/**
 * gitlabVariables tests — predefined-variable detection and component-URL expansion.
 *
 * The load-bearing case here is the braced `${VAR}` form (issue #136): GitLab CI accepts both
 * `$CI_SERVER_FQDN` and `${CI_SERVER_FQDN}`, but only the bare form used to be detected/expanded,
 * so a braced component URL got no hover/completion/validation.
 */

import * as assert from 'node:assert/strict';
import {
  detectGitLabVariables,
  containsGitLabVariables,
  expandComponentUrl,
} from '../../src/utils/gitlabVariables';

suite('detectGitLabVariables', () => {
  test('detects the bare $VAR form', () => {
    assert.deepStrictEqual(detectGitLabVariables('$CI_SERVER_FQDN/group/comp@1.0.0'), ['CI_SERVER_FQDN']);
  });

  test('detects the braced ${VAR} form', () => {
    assert.deepStrictEqual(detectGitLabVariables('${CI_SERVER_FQDN}/group/comp@1.0.0'), ['CI_SERVER_FQDN']);
  });

  test('detects both forms in the same string', () => {
    assert.deepStrictEqual(
      detectGitLabVariables('${CI_SERVER_FQDN}/$CI_PROJECT_PATH/comp@1.0.0'),
      ['CI_SERVER_FQDN', 'CI_PROJECT_PATH'],
    );
  });

  test('ignores non-predefined variables in either form', () => {
    assert.deepStrictEqual(detectGitLabVariables('$NOT_A_GITLAB_VAR/${ALSO_NOT_ONE}'), []);
  });
});

suite('containsGitLabVariables', () => {
  test('is true for both the bare and braced forms', () => {
    assert.strictEqual(containsGitLabVariables('$CI_SERVER_FQDN/x'), true);
    assert.strictEqual(containsGitLabVariables('${CI_SERVER_FQDN}/x'), true);
  });

  test('is false when no predefined variable is present', () => {
    assert.strictEqual(containsGitLabVariables('gitlab.com/group/comp@1.0.0'), false);
  });
});

suite('expandComponentUrl — braced and bare forms expand identically', () => {
  const context = { gitlabInstance: 'gitlab.example.com', projectPath: 'my-group/my-project' };

  test('$CI_SERVER_FQDN expands to an https:// URL in both forms', () => {
    const expected = 'https://gitlab.example.com/group/comp@1.0.0';
    assert.strictEqual(expandComponentUrl('$CI_SERVER_FQDN/group/comp@1.0.0', context), expected);
    assert.strictEqual(expandComponentUrl('${CI_SERVER_FQDN}/group/comp@1.0.0', context), expected);
  });

  test('a mid-path braced variable is expanded', () => {
    assert.strictEqual(
      expandComponentUrl('$CI_SERVER_FQDN/${CI_PROJECT_PATH}/comp@1.0.0', context),
      'https://gitlab.example.com/my-group/my-project/comp@1.0.0',
    );
  });
});
