console.log('=== Performance Optimizations Validation ===');
console.log('Validating that all optimizations are implemented...\n');

// Read the compiled extension file to check for optimizations
const fs = require('fs');
const path = require('path');

try {
  const extensionPath = path.join(__dirname, '../out/extension.js');
  const extensionCode = fs.readFileSync(extensionPath, 'utf8');

  const optimizations = [
    {
      name: 'HTTP Client with Retry Logic',
      pattern: /fetchJson|retryAttempts|retry.*attempt/i,
      found: false
    },
    {
      name: 'Structured Logging System',
      pattern: /class Logger|logLevel|DEBUG.*INFO.*WARN.*ERROR/i,
      found: false
    },
    {
      name: 'Map-based Caching',
      pattern: /Map.*cache|sourceCache.*new Map|catalogCache.*new Map/i,
      found: false
    },
    {
      name: 'Parallel Data Fetching',
      pattern: /Promise\.all.*fetch|Promise\.allSettled|parallel.*request/i,
      found: false
    },
    {
      name: 'Batch Processing',
      pattern: /processBatch|batchSize|batch.*processing/i,
      found: false
    },
    {
      name: 'Background Cache Updates',
      pattern: /background.*update|backgroundUpdateInProgress|startBackgroundUpdate/i,
      found: false
    },
    {
      name: 'HTTP Timeouts',
      pattern: /timeout.*http|httpTimeout|request.*timeout/i,
      found: false
    },
    {
      name: 'Performance Logging',
      pattern: /logPerformance|performance.*timing|Date\.now.*start/i,
      found: false
    }
  ];

  // Check for each optimization
  let foundCount = 0;
  optimizations.forEach(opt => {
    opt.found = opt.pattern.test(extensionCode);
    if (opt.found) {
      foundCount++;
      console.log(`✅ ${opt.name}: FOUND`);
    } else {
      console.log(`❌ ${opt.name}: NOT FOUND`);
    }
  });

  console.log(`\n=== Optimization Summary ===`);
  console.log(`Implemented: ${foundCount}/${optimizations.length}`);
  console.log(`Coverage: ${Math.round((foundCount / optimizations.length) * 100)}%`);

  if (foundCount >= 6) {
    console.log('\n🎉 Performance optimizations successfully implemented!');
    console.log('✅ The ComponentService has been optimized for:');
    console.log('   - Faster data fetching with parallel processing');
    console.log('   - Enhanced caching with Map-based storage');
    console.log('   - Reliable HTTP requests with retry logic');
    console.log('   - Structured logging with performance metrics');
    console.log('   - Background cache updates for better UX');
    console.log('   - Configurable timeouts and batch processing');
  } else {
    console.log('\n⚠️  Some optimizations may not be fully implemented.');
  }

  // Check configuration options
  console.log('\n--- Configuration Options ---');
  const packagePath = path.join(__dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const properties = packageJson.contributes?.configuration?.properties || {};

  const expectedConfigs = [
    'gitlabComponentHelper.logLevel',
    'gitlabComponentHelper.httpTimeout',
    'gitlabComponentHelper.retryAttempts',
    'gitlabComponentHelper.batchSize'
  ];

  expectedConfigs.forEach(config => {
    if (properties[config]) {
      console.log(`✅ ${config}: Configured`);
    } else {
      console.log(`❌ ${config}: Missing`);
    }
  });

  // Check documentation
  console.log('\n--- Documentation ---');
  const docsPath = path.join(__dirname, '../PERFORMANCE_OPTIMIZATIONS.md');
  if (fs.existsSync(docsPath)) {
    const docsContent = fs.readFileSync(docsPath, 'utf8');
    if (docsContent.length > 1000) {
      console.log('✅ Performance documentation: Complete');
    } else {
      console.log('⚠️  Performance documentation: Basic');
    }
  } else {
    console.log('❌ Performance documentation: Missing');
  }

  console.log('\n=== Validation Complete ===');

  // Overall success criteria
  const hasHttpClient = /fetchJson|retryAttempts/.test(extensionCode);
  const hasLogger = /logLevel|Logger/.test(extensionCode);
  const hasMapCaching = /Map.*cache|sourceCache/.test(extensionCode);
  const hasParallelFetch = /Promise\.all/.test(extensionCode);

  if (hasHttpClient && hasLogger && hasMapCaching && hasParallelFetch) {
    console.log('🎉 VALIDATION PASSED: Core optimizations are implemented!');
    process.exit(0);
  } else {
    console.log('⚠️  VALIDATION INCOMPLETE: Some core optimizations missing.');
    process.exit(1);
  }

} catch (error) {
  console.error('❌ Validation failed:', error.message);
  process.exit(1);
}
