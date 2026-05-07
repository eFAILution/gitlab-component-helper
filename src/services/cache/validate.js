#!/usr/bin/env node

/**
 * Validation script for UnifiedCache infrastructure
 * Run with: node src/services/cache/validate.js
 */

const fs = require('fs');
const path = require('path');

const CACHE_DIR = __dirname;
const REQUIRED_FILES = [
  'cacheTypes.ts',
  'unifiedCache.ts',
  'index.ts',
  'README.md',
  'EXAMPLES.md',
  'MIGRATION.md',
  'SUMMARY.md'
];

const REQUIRED_EXPORTS = [
  'UnifiedCache',
  'getUnifiedCache',
  'resetUnifiedCache',
  'CacheType',
  'CacheStats',
  'CacheGetOptions',
  'CacheGetResult',
  'CacheFetcher',
  'UnifiedCacheEntry',
  'SerializedCacheData'
];

console.log('Validating UnifiedCache Infrastructure...\n');

let allValid = true;

// Check required files exist
console.log('Checking required files...');
for (const file of REQUIRED_FILES) {
  const filePath = path.join(CACHE_DIR, file);
  const exists = fs.existsSync(filePath);
  const status = exists ? '✓' : '✗';
  console.log(`  ${status} ${file}`);
  if (!exists) {
    allValid = false;
  }
}

console.log('');

// Check file sizes
console.log('Checking file sizes (should be < 500 lines)...');
for (const file of REQUIRED_FILES.filter(f => f.endsWith('.ts'))) {
  const filePath = path.join(CACHE_DIR, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n').length;
    const status = lines < 500 ? '✓' : '✗';
    console.log(`  ${status} ${file}: ${lines} lines`);
    if (lines >= 500) {
      allValid = false;
    }
  }
}

console.log('');

// Check exports
console.log('Checking exports in index.ts...');
const indexPath = path.join(CACHE_DIR, 'index.ts');
if (fs.existsSync(indexPath)) {
  const indexContent = fs.readFileSync(indexPath, 'utf8');

  for (const exportName of REQUIRED_EXPORTS) {
    const hasExport = indexContent.includes(exportName);
    const status = hasExport ? '✓' : '✗';
    console.log(`  ${status} ${exportName}`);
    if (!hasExport) {
      allValid = false;
    }
  }
}

console.log('');

// Check TypeScript syntax (basic validation)
console.log('Checking TypeScript syntax...');
for (const file of REQUIRED_FILES.filter(f => f.endsWith('.ts'))) {
  const filePath = path.join(CACHE_DIR, file);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');

    // Basic syntax checks
    const hasImport = file === 'unifiedCache.ts' ? content.includes('import') : true;
    const hasExport = content.includes('export');
    const balanced = (content.match(/\{/g) || []).length === (content.match(/\}/g) || []).length;

    const status = hasImport && hasExport && balanced ? '✓' : '✗';
    console.log(`  ${status} ${file}`);

    if (!hasImport || !hasExport || !balanced) {
      console.log(`    - Missing imports: ${!hasImport}`);
      console.log(`    - Missing exports: ${!hasExport}`);
      console.log(`    - Unbalanced braces: ${!balanced}`);
      allValid = false;
    }
  }
}

console.log('');

// Check documentation completeness
console.log('Checking documentation completeness...');
const readmePath = path.join(CACHE_DIR, 'README.md');
if (fs.existsSync(readmePath)) {
  const readme = fs.readFileSync(readmePath, 'utf8');
  const sections = [
    '## Overview',
    '## Architecture',
    '## Basic Usage',
    '## Advanced Usage',
    '## Migration Guide',
    '## API'
  ];

  for (const section of sections) {
    const hasSection = readme.includes(section);
    const status = hasSection ? '✓' : '✗';
    console.log(`  ${status} ${section}`);
    if (!hasSection) {
      allValid = false;
    }
  }
}

console.log('');

// Summary
console.log('==========================================');
if (allValid) {
  console.log('✓ All validation checks passed!');
  console.log('✓ UnifiedCache infrastructure is ready for use');
  console.log('✓ Ready to migrate existing code');
} else {
  console.log('✗ Some validation checks failed');
  console.log('✗ Please fix issues before proceeding');
  process.exit(1);
}
console.log('==========================================');
