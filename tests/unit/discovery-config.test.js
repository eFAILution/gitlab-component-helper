/**
 * Discovery Config Behavior Contract
 *
 * Mirrors the pure helpers in src/services/component/discoveryConfig.ts and
 * asserts the merge / clamp / candidate-building rules that the extension
 * relies on when discovering components in user repositories.
 *
 * Per tests/run-tests.js convention, this is an inline-logic characterization
 * test. The corresponding source module is verified end-to-end at the
 * extension-host layer.
 */
/* eslint-env node */
const assert = require('assert');

const HARD_DEFAULTS = Object.freeze({
  templateRoots: ['templates'],
  maxDepth: 1,
  filePatterns: ['*.yml', '*.yaml'],
  templateFileNames: ['template.yml', 'template.yaml'],
});

const DISCOVERY_LIMITS = Object.freeze({
  maxDepth: 3,
  templateRootsCount: 5,
  filePatternsCount: 10,
  templateFileNamesCount: 10,
});

function mergeDiscoveryConfig(global, override) {
  return {
    templateRoots:
      override?.templateRoots ?? global?.templateRoots ?? [...HARD_DEFAULTS.templateRoots],
    maxDepth: override?.maxDepth ?? global?.maxDepth ?? HARD_DEFAULTS.maxDepth,
    filePatterns:
      override?.filePatterns ?? global?.filePatterns ?? [...HARD_DEFAULTS.filePatterns],
    templateFileNames:
      override?.templateFileNames ??
      global?.templateFileNames ??
      [...HARD_DEFAULTS.templateFileNames],
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function normalizeRoot(root) {
  if (typeof root !== 'string') return '';
  const trimmed = root.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!trimmed || trimmed.includes('..')) return '';
  return trimmed;
}

function isFilenamePattern(pattern) {
  if (typeof pattern !== 'string' || !pattern) return false;
  if (pattern.includes('/') || pattern.includes('..')) return false;
  return pattern.startsWith('*') || /^[\w.-]+$/.test(pattern);
}

function isFilenameOnly(name) {
  return typeof name === 'string' && !!name && !name.includes('/') && !name.includes('..');
}

function dedupe(items) {
  return Array.from(new Set(items));
}

function clampDiscoveryConfig(config) {
  return {
    templateRoots: dedupe(
      config.templateRoots
        .slice(0, DISCOVERY_LIMITS.templateRootsCount)
        .map(normalizeRoot)
        .filter(Boolean),
    ),
    maxDepth: clamp(config.maxDepth, 0, DISCOVERY_LIMITS.maxDepth),
    filePatterns: dedupe(
      config.filePatterns
        .slice(0, DISCOVERY_LIMITS.filePatternsCount)
        .filter(isFilenamePattern),
    ),
    templateFileNames: dedupe(
      config.templateFileNames
        .slice(0, DISCOVERY_LIMITS.templateFileNamesCount)
        .filter(isFilenameOnly),
    ),
  };
}

function patternExtension(pattern) {
  if (pattern.startsWith('*')) {
    return pattern.slice(1);
  }
  return undefined;
}

function buildTemplatePathCandidates(componentName, config) {
  const candidates = [];
  for (const root of config.templateRoots) {
    for (const pattern of config.filePatterns) {
      const ext = patternExtension(pattern);
      if (ext !== undefined) {
        candidates.push(`${root}/${componentName}${ext}`);
      }
    }
    for (const fileName of config.templateFileNames) {
      candidates.push(`${root}/${componentName}/${fileName}`);
    }
  }
  return dedupe(candidates);
}

function matchesFilePattern(filename, patterns) {
  return patterns.some((pattern) => {
    const ext = patternExtension(pattern);
    if (ext !== undefined) {
      return ext === '' ? true : filename.endsWith(ext);
    }
    return filename === pattern;
  });
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${error.message}`);
    failed++;
  }
}

console.log('=== Discovery Config Behavior Contract ===\n');

console.log('--- mergeDiscoveryConfig ---');
check('falls back to hard defaults when nothing provided', () => {
  assert.deepStrictEqual(mergeDiscoveryConfig(undefined, undefined), {
    templateRoots: ['templates'],
    maxDepth: 1,
    filePatterns: ['*.yml', '*.yaml'],
    templateFileNames: ['template.yml', 'template.yaml'],
  });
});
check('uses global override when no source override', () => {
  const result = mergeDiscoveryConfig(
    { templateRoots: ['ci/components'], maxDepth: 2 },
    undefined,
  );
  assert.deepStrictEqual(result.templateRoots, ['ci/components']);
  assert.strictEqual(result.maxDepth, 2);
  assert.deepStrictEqual(result.filePatterns, ['*.yml', '*.yaml']);
});
check('source override wins over global', () => {
  const result = mergeDiscoveryConfig(
    { templateRoots: ['global'], maxDepth: 1 },
    { templateRoots: ['source-specific'] },
  );
  assert.deepStrictEqual(result.templateRoots, ['source-specific']);
  assert.strictEqual(result.maxDepth, 1, 'unspecified source field still pulls from global');
});
check('partial override does not bleed into other fields', () => {
  const result = mergeDiscoveryConfig({}, { maxDepth: 3 });
  assert.deepStrictEqual(result.templateRoots, ['templates']);
  assert.strictEqual(result.maxDepth, 3);
});

console.log('\n--- clampDiscoveryConfig ---');
check('caps maxDepth at limit', () => {
  const result = clampDiscoveryConfig({
    templateRoots: ['templates'],
    maxDepth: 99,
    filePatterns: ['*.yml'],
    templateFileNames: ['template.yml'],
  });
  assert.strictEqual(result.maxDepth, DISCOVERY_LIMITS.maxDepth);
});
check('floors maxDepth at zero', () => {
  const result = clampDiscoveryConfig({
    templateRoots: ['templates'],
    maxDepth: -5,
    filePatterns: ['*.yml'],
    templateFileNames: ['template.yml'],
  });
  assert.strictEqual(result.maxDepth, 0);
});
check('coerces non-finite maxDepth to zero', () => {
  const result = clampDiscoveryConfig({
    templateRoots: ['templates'],
    maxDepth: Number.NaN,
    filePatterns: [],
    templateFileNames: [],
  });
  assert.strictEqual(result.maxDepth, 0);
});
check('limits templateRoots count and strips slashes', () => {
  const tooMany = Array.from({ length: 20 }, (_, i) => `/root${i}/`);
  const result = clampDiscoveryConfig({
    templateRoots: tooMany,
    maxDepth: 1,
    filePatterns: ['*.yml'],
    templateFileNames: ['template.yml'],
  });
  assert.strictEqual(result.templateRoots.length, DISCOVERY_LIMITS.templateRootsCount);
  result.templateRoots.forEach((root) => {
    assert.ok(!root.startsWith('/'), `expected no leading slash in "${root}"`);
    assert.ok(!root.endsWith('/'), `expected no trailing slash in "${root}"`);
  });
});
check('rejects path-traversal in templateRoots', () => {
  const result = clampDiscoveryConfig({
    templateRoots: ['../escape', 'templates'],
    maxDepth: 1,
    filePatterns: ['*.yml'],
    templateFileNames: [],
  });
  assert.deepStrictEqual(result.templateRoots, ['templates']);
});
check('rejects path globs in filePatterns', () => {
  const result = clampDiscoveryConfig({
    templateRoots: ['templates'],
    maxDepth: 1,
    filePatterns: ['*.yml', 'foo/*.yml', '../bad', '*.yaml'],
    templateFileNames: [],
  });
  assert.deepStrictEqual(result.filePatterns, ['*.yml', '*.yaml']);
});
check('dedupes templateRoots after normalization', () => {
  const result = clampDiscoveryConfig({
    templateRoots: ['templates', '/templates/', 'templates'],
    maxDepth: 1,
    filePatterns: ['*.yml'],
    templateFileNames: [],
  });
  assert.deepStrictEqual(result.templateRoots, ['templates']);
});
check('rejects templateFileNames containing slashes', () => {
  const result = clampDiscoveryConfig({
    templateRoots: ['templates'],
    maxDepth: 1,
    filePatterns: [],
    templateFileNames: ['template.yml', 'sub/template.yml'],
  });
  assert.deepStrictEqual(result.templateFileNames, ['template.yml']);
});

console.log('\n--- buildTemplatePathCandidates ---');
check('produces 4 default candidates matching legacy hardcoded set', () => {
  const config = clampDiscoveryConfig(mergeDiscoveryConfig(undefined, undefined));
  const candidates = buildTemplatePathCandidates('foo', config);
  assert.deepStrictEqual(candidates, [
    'templates/foo.yml',
    'templates/foo.yaml',
    'templates/foo/template.yml',
    'templates/foo/template.yaml',
  ]);
});
check('expands across multiple roots', () => {
  const candidates = buildTemplatePathCandidates('foo', {
    templateRoots: ['templates', 'ci/components'],
    maxDepth: 1,
    filePatterns: ['*.yml'],
    templateFileNames: ['template.yml'],
  });
  assert.deepStrictEqual(candidates, [
    'templates/foo.yml',
    'templates/foo/template.yml',
    'ci/components/foo.yml',
    'ci/components/foo/template.yml',
  ]);
});
check('skips non-extension patterns when building flat candidates', () => {
  const candidates = buildTemplatePathCandidates('foo', {
    templateRoots: ['templates'],
    maxDepth: 1,
    filePatterns: ['component.yml'],
    templateFileNames: ['template.yml'],
  });
  assert.deepStrictEqual(candidates, ['templates/foo/template.yml']);
});

console.log('\n--- matchesFilePattern ---');
check('matches glob extension', () => {
  assert.strictEqual(matchesFilePattern('foo.yml', ['*.yml']), true);
  assert.strictEqual(matchesFilePattern('foo.yaml', ['*.yml']), false);
});
check('matches exact filename', () => {
  assert.strictEqual(matchesFilePattern('component.yml', ['component.yml']), true);
  assert.strictEqual(matchesFilePattern('other.yml', ['component.yml']), false);
});
check('returns false for empty pattern list', () => {
  assert.strictEqual(matchesFilePattern('foo.yml', []), false);
});

console.log('\n=== Discovery Config Test Summary ===');
console.log(`Total: ${passed + failed}`);
console.log(`Passed: ${passed} ✅`);
if (failed > 0) {
  console.log(`Failed: ${failed} ❌`);
  process.exit(1);
}
console.log('🎉 All discovery config contract tests passed!');
