// @mocha
/**
 * includeMatcher tests — the pure include line-matching helpers used by the validation provider to anchor
 * diagnostics to the correct include entry.
 *
 * The critical case is `includeLineMatches` token-boundary matching: a versioned URL (`…@deploy-1`) must not
 * match a line declaring a longer sibling (`…@deploy-10`), or the provider's occurrence counter (exact equality)
 * disagrees with the document walk (line match) and anchors a diagnostic onto the wrong include.
 */

import * as assert from 'node:assert/strict';
import {
    isIncludeEntry,
    isLocalInclude,
    includeKeyAndUrl,
    includeLineMatches,
} from '../../src/utils/includeMatcher';

suite('includeMatcher — isIncludeEntry', () => {
    test('accepts a component include', () => {
        assert.equal(isIncludeEntry({ component: 'host/g/c@1' }), true);
    });

    test('accepts a local include', () => {
        assert.equal(isIncludeEntry({ local: 'templates/x.yml' }), true);
    });

    test('rejects an entry with both component and local', () => {
        assert.equal(isIncludeEntry({ component: 'host/g/c@1', local: 'x.yml' }), false);
    });

    test('rejects an entry with neither', () => {
        assert.equal(isIncludeEntry({ project: 'g/p', file: 'x.yml' }), false);
    });

    test('rejects non-objects', () => {
        assert.equal(isIncludeEntry('component: x'), false);
        assert.equal(isIncludeEntry(null), false);
        assert.equal(isIncludeEntry(['component']), false);
    });
});

suite('includeMatcher — isLocalInclude / includeKeyAndUrl', () => {
    test('isLocalInclude distinguishes local from component', () => {
        assert.equal(isLocalInclude({ local: 'x.yml' }), true);
        assert.equal(isLocalInclude({ component: 'host/g/c@1' }), false);
    });

    test('includeKeyAndUrl returns component key+url', () => {
        assert.deepEqual(includeKeyAndUrl({ component: 'host/g/c@1' }), {
            key: 'component:',
            url: 'host/g/c@1',
        });
    });

    test('includeKeyAndUrl returns local key+url', () => {
        assert.deepEqual(includeKeyAndUrl({ local: 'templates/x.yml' }), {
            key: 'local:',
            url: 'templates/x.yml',
        });
    });
});

suite('includeMatcher — includeLineMatches token boundary', () => {
    const url = 'host/g/c@deploy-1';

    test('matches when the URL is at end of line', () => {
        assert.equal(includeLineMatches(`  - component: ${url}`, 'component:', url), true);
    });

    test('matches when followed by whitespace (trailing space / comment)', () => {
        assert.equal(includeLineMatches(`  - component: ${url}  # pinned`, 'component:', url), true);
    });

    test('matches when the URL is wrapped in quotes', () => {
        assert.equal(includeLineMatches(`  - component: "${url}"`, 'component:', url), true);
        assert.equal(includeLineMatches(`  - component: '${url}'`, 'component:', url), true);
    });

    test('does NOT match a longer sibling where the URL is only a prefix', () => {
        // The bug this guards: `@deploy-1` appears as a prefix of `@deploy-10`.
        assert.equal(includeLineMatches('  - component: host/g/c@deploy-10', 'component:', url), false);
    });

    test('does NOT match when the include key is absent', () => {
        assert.equal(includeLineMatches(`      some_input: ${url}`, 'component:', url), false);
    });

    test('does NOT match when the URL is absent', () => {
        assert.equal(includeLineMatches('  - component: host/g/other@1', 'component:', url), false);
    });

    test('local-path prefix collision is rejected too', () => {
        const localUrl = 'templates/deploy';
        assert.equal(includeLineMatches('  - local: templates/deploy10', 'local:', localUrl), false);
        assert.equal(includeLineMatches('  - local: templates/deploy', 'local:', localUrl), true);
    });
});
