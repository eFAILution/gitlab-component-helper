// @mocha
/**
 * Unit tests for the pure version-check detection in src/providers/componentVersionCheck.ts. A map-based resolver
 * stands in for the provider's async GitLab version lookup, so these exercise ref splitting, base collection, the
 * clean-semver gate, latest-stable comparison, and the exact column span placed on the version ref.
 */

import * as assert from 'node:assert/strict';
import {
  splitComponentRef,
  collectSemverComponentBases,
  findOutdatedComponentRefs,
} from '../../src/providers/componentVersionCheck';

const BASE = 'https://gitlab.com/components/opentofu/full-pipeline';

/** Build a resolver from a base-URL → versions map for the pure finder. */
const resolver = (map: Record<string, string[]>) => (baseUrl: string) => map[baseUrl];

suite('splitComponentRef', () => {
  test('splits the trailing @version off the base URL', () => {
    assert.deepEqual(splitComponentRef(`${BASE}@1.2.3`), { baseUrl: BASE, version: '1.2.3' });
  });

  test('reports no version when there is no @ref', () => {
    assert.deepEqual(splitComponentRef(BASE), { baseUrl: BASE, version: undefined });
  });
});

suite('collectSemverComponentBases', () => {
  test('returns the bases of clean-semver component refs only, deduped', () => {
    const text = [
      'include:',
      `  - component: ${BASE}@1.2.3`,
      `  - component: ${BASE}@1.2.3`, // duplicate base -> collapsed
      `  - component: https://gitlab.com/g/p/other@main`, // floating -> skipped
      `  - component: https://gitlab.com/g/p/third@2.0.0`,
    ].join('\n');
    assert.deepEqual(collectSemverComponentBases(text), [BASE, 'https://gitlab.com/g/p/third']);
  });
});

suite('findOutdatedComponentRefs', () => {
  test('flags a component behind the latest stable release', () => {
    const text = `include:\n  - component: ${BASE}@1.2.3`;
    const findings = findOutdatedComponentRefs(text, resolver({ [BASE]: ['main', '1.2.3', '1.5.0', '2.0.0-rc.1'] }));

    assert.equal(findings.length, 1);
    const f = findings[0];
    assert.equal(f.currentVersion, '1.2.3');
    assert.equal(f.latestVersion, '1.5.0'); // rc ignored
    assert.equal(f.componentName, 'full-pipeline');
    assert.equal(f.line, 1);
  });

  test('places the range on exactly the version ref', () => {
    const lineText = `  - component: ${BASE}@1.2.3`;
    const text = `include:\n${lineText}`;
    const [f] = findOutdatedComponentRefs(text, resolver({ [BASE]: ['1.5.0'] }));

    const expectedStart = lineText.indexOf('@1.2.3') + 1; // just past the '@'
    assert.equal(f.refStart, expectedStart);
    assert.equal(f.refEnd, expectedStart + '1.2.3'.length);
    // The exact slice the squiggle/quick-fix targets is the version only.
    assert.equal(lineText.slice(f.refStart, f.refEnd), '1.2.3');
  });

  test('handles a quoted URL value', () => {
    const lineText = `  - component: "${BASE}@1.2.3"`;
    const text = `include:\n${lineText}`;
    const [f] = findOutdatedComponentRefs(text, resolver({ [BASE]: ['1.5.0'] }));
    assert.equal(lineText.slice(f.refStart, f.refEnd), '1.2.3');
  });

  test('does not flag when already on the latest stable', () => {
    const text = `include:\n  - component: ${BASE}@1.5.0`;
    assert.deepEqual(findOutdatedComponentRefs(text, resolver({ [BASE]: ['1.2.0', '1.5.0'] })), []);
  });

  test('skips floating and non-semver refs', () => {
    const text = [
      'include:',
      `  - component: ${BASE}@main`,
      `  - component: ${BASE}@~latest`,
      `  - component: ${BASE}@1.2`,
    ].join('\n');
    assert.deepEqual(findOutdatedComponentRefs(text, resolver({ [BASE]: ['1.5.0'] })), []);
  });

  test('skips components whose versions could not be resolved', () => {
    const text = `include:\n  - component: ${BASE}@1.2.3`;
    assert.deepEqual(findOutdatedComponentRefs(text, resolver({})), []);
  });
});
