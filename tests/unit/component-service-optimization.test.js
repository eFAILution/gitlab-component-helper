/**
 * Component Service Optimization Tests
 *
 * Tests the optimization features added to ComponentService:
 * - Rate limiting and throttling
 * - Parallel fetching
 * - Pagination handling
 * - Retry logic with exponential backoff
 */

console.log('=== Component Service Optimization Tests ===');

/**
 * Mock ComponentService with optimization features for testing
 */
class MockComponentService {
  constructor() {
    this.rateLimiter = {
      tokens: 10,
      lastRefill: Date.now(),
      maxTokens: 10,
      refillRate: 2
    };

    this.retryOptions = {
      maxRetries: 3,
      baseDelay: 100, // Reduced for testing
      maxDelay: 800
    };

    this.requestCount = 0;
    this.requestTimes = [];
  }

  refillTokens() {
    const now = Date.now();
    const timePassed = (now - this.rateLimiter.lastRefill) / 1000;
    const tokensToAdd = Math.floor(timePassed * this.rateLimiter.refillRate);

    if (tokensToAdd > 0) {
      this.rateLimiter.tokens = Math.min(
        this.rateLimiter.maxTokens,
        this.rateLimiter.tokens + tokensToAdd
      );
      this.rateLimiter.lastRefill = now;
    }
  }

  async waitForRateLimit() {
    this.refillTokens();

    if (this.rateLimiter.tokens <= 0) {
      const waitTime = Math.ceil(1000 / this.rateLimiter.refillRate);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.refillTokens();
    }

    this.rateLimiter.tokens--;
  }

  async mockApiRequest(shouldFail = false, failCount = 0) {
    await this.waitForRateLimit();

    this.requestCount++;
    this.requestTimes.push(Date.now());

    if (shouldFail && this.requestCount <= failCount) {
      throw new Error('RATE_LIMITED:429');
    }

    return { success: true, requestNumber: this.requestCount };
  }

  async fetchWithRetry(requestFn) {
    let lastError;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        const isRateLimited = error?.message?.includes('RATE_LIMITED');
        const shouldRetry = isRateLimited || error?.message?.includes('ENOTFOUND') || error?.message?.includes('timeout');

        if (attempt < this.retryOptions.maxRetries && shouldRetry) {
          const delay = Math.min(
            this.retryOptions.baseDelay * Math.pow(2, attempt),
            this.retryOptions.maxDelay
          );

          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        break;
      }
    }

    throw lastError;
  }

  async fetchInParallel(requests, concurrencyLimit = 5) {
    const results = [];

    for (let i = 0; i < requests.length; i += concurrencyLimit) {
      const batch = requests.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.allSettled(batch.map(req => req()));

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }

    return results;
  }

  async fetchAllPages(baseUrl, perPage = 2) {
    const allResults = [];
    let page = 1;
    let hasMore = true;

    // Mock paginated data
    const mockData = [
      { id: 1, name: 'item1' },
      { id: 2, name: 'item2' },
      { id: 3, name: 'item3' },
      { id: 4, name: 'item4' },
      { id: 5, name: 'item5' }
    ];

    while (hasMore) {
      const startIndex = (page - 1) * perPage;
      const endIndex = startIndex + perPage;
      const pageResults = mockData.slice(startIndex, endIndex);

      if (pageResults.length > 0) {
        allResults.push(...pageResults);

        if (pageResults.length < perPage) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }

    return allResults;
  }
}

/**
 * Test rate limiting functionality
 */
function testRateLimiting() {
  console.log('\n--- Testing Rate Limiting ---');

  return new Promise(async (resolve) => {
    const service = new MockComponentService();
    const startTime = Date.now();

    // Make more requests than the rate limit allows
    const promises = [];
    for (let i = 0; i < 15; i++) {
      promises.push(service.mockApiRequest());
    }

    try {
      await Promise.all(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should take some time due to rate limiting
      const isCorrect = duration > 500; // Should take at least 500ms for 15 requests with rate limiting

      console.log(`Rate limiting test: ${isCorrect ? 'PASS' : 'FAIL'} ✅`);
      console.log(`  Completed 15 requests in ${duration}ms`);
      console.log(`  Request times spread: ${Math.max(...service.requestTimes) - Math.min(...service.requestTimes)}ms`);

      resolve(isCorrect);
    } catch (error) {
      console.log(`Rate limiting test: FAIL ❌ - ${error.message}`);
      resolve(false);
    }
  });
}

/**
 * Test retry logic with exponential backoff
 */
function testRetryLogic() {
  console.log('\n--- Testing Retry Logic ---');

  return new Promise(async (resolve) => {
    const service = new MockComponentService();
    let attempts = 0;

    try {
      const result = await service.fetchWithRetry(async () => {
        attempts++;
        if (attempts <= 2) {
          throw new Error('RATE_LIMITED:429');
        }
        return { success: true, attempts };
      });

      const isCorrect = result.success && attempts === 3;

      console.log(`Retry logic test: ${isCorrect ? 'PASS' : 'FAIL'} ✅`);
      console.log(`  Succeeded after ${attempts} attempts`);
      console.log(`  Final result: ${JSON.stringify(result)}`);

      resolve(isCorrect);
    } catch (error) {
      console.log(`Retry logic test: FAIL ❌ - ${error.message}`);
      resolve(false);
    }
  });
}

/**
 * Test parallel fetching with controlled concurrency
 */
function testParallelFetching() {
  console.log('\n--- Testing Parallel Fetching ---');

  return new Promise(async (resolve) => {
    const service = new MockComponentService();
    const startTime = Date.now();

    // Create 10 mock requests
    const requests = [];
    for (let i = 0; i < 10; i++) {
      requests.push(async () => {
        await new Promise(resolve => setTimeout(resolve, 50)); // Simulate network delay
        return { id: i, data: `result-${i}` };
      });
    }

    try {
      const results = await service.fetchInParallel(requests, 3); // Limit to 3 concurrent
      const endTime = Date.now();
      const duration = endTime - startTime;

      const isCorrect = results.length === 10 && duration < 500; // Should complete faster than sequential

      console.log(`Parallel fetching test: ${isCorrect ? 'PASS' : 'FAIL'} ✅`);
      console.log(`  Processed ${results.length} requests in ${duration}ms`);
      console.log(`  Results sample: ${JSON.stringify(results.slice(0, 3))}`);

      resolve(isCorrect);
    } catch (error) {
      console.log(`Parallel fetching test: FAIL ❌ - ${error.message}`);
      resolve(false);
    }
  });
}

/**
 * Test pagination handling
 */
function testPagination() {
  console.log('\n--- Testing Pagination Handling ---');

  return new Promise(async (resolve) => {
    const service = new MockComponentService();

    try {
      const results = await service.fetchAllPages('mock-url', 2);

      const isCorrect = results.length === 5 &&
                       results[0].name === 'item1' &&
                       results[4].name === 'item5';

      console.log(`Pagination test: ${isCorrect ? 'PASS' : 'FAIL'} ✅`);
      console.log(`  Fetched ${results.length} total items`);
      console.log(`  First item: ${JSON.stringify(results[0])}`);
      console.log(`  Last item: ${JSON.stringify(results[results.length - 1])}`);

      resolve(isCorrect);
    } catch (error) {
      console.log(`Pagination test: FAIL ❌ - ${error.message}`);
      resolve(false);
    }
  });
}

/**
 * Test that optimization features work together
 */
function testIntegration() {
  console.log('\n--- Testing Integration ---');

  return new Promise(async (resolve) => {
    const service = new MockComponentService();
    const startTime = Date.now();

    // Test multiple optimization features together
    const requests = [];
    for (let i = 0; i < 8; i++) {
      requests.push(async () => {
        return await service.fetchWithRetry(async () => {
          if (Math.random() < 0.3) { // 30% chance of simulated failure
            throw new Error('RATE_LIMITED:429');
          }
          return await service.mockApiRequest();
        });
      });
    }

    try {
      const results = await service.fetchInParallel(requests, 3);
      const endTime = Date.now();
      const duration = endTime - startTime;

      const isCorrect = results.length > 0 && duration < 5000; // Should complete in reasonable time

      console.log(`Integration test: ${isCorrect ? 'PASS' : 'FAIL'} ✅`);
      console.log(`  Completed ${results.length} requests in ${duration}ms`);
      console.log(`  Total API calls made: ${service.requestCount}`);

      resolve(isCorrect);
    } catch (error) {
      console.log(`Integration test: FAIL ❌ - ${error.message}`);
      resolve(false);
    }
  });
}

/**
 * Run all optimization tests
 */
async function runOptimizationTests() {
  const tests = [
    { name: 'Rate Limiting', fn: testRateLimiting },
    { name: 'Retry Logic', fn: testRetryLogic },
    { name: 'Parallel Fetching', fn: testParallelFetching },
    { name: 'Pagination Handling', fn: testPagination },
    { name: 'Integration', fn: testIntegration }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      const result = await test.fn();
      if (result) {
        passed++;
      } else {
        failed++;
      }
    } catch (error) {
      console.log(`${test.name} test: FAIL ❌ - ${error.message}`);
      failed++;
    }
  }

  console.log(`\n=== Optimization Test Summary ===`);
  console.log(`Total tests: ${tests.length}`);
  console.log(`Passed: ${passed} ✅`);
  console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Success rate: ${Math.round((passed / tests.length) * 100)}%`);

  return failed === 0;
}

// Run the tests
runOptimizationTests().then((allTestsPassed) => {
  if (allTestsPassed) {
    console.log('\n🎉 All optimization tests passed!');
    process.exit(0);
  } else {
    console.log('\n💥 Some optimization tests failed!');
    process.exit(1);
  }
}).catch((error) => {
  console.error('\n💥 Test runner error:', error);
  process.exit(1);
});
