/**
 * Component Service Optimization Demo
 *
 * This script demonstrates the optimization features implemented in ComponentService:
 * - Rate limiting and throttling
 * - Parallel fetching
 * - Pagination handling
 * - Retry logic with exponential backoff
 */

console.log('=== ComponentService Optimization Demo ===\n');

// Mock implementation to demonstrate the concepts
class OptimizedComponentService {
  constructor() {
    console.log('🚀 Initializing OptimizedComponentService...');

    // Rate limiting configuration
    this.rateLimiter = {
      tokens: 10,        // Max 10 concurrent requests
      lastRefill: Date.now(),
      maxTokens: 10,
      refillRate: 2      // 2 tokens per second
    };

    // Retry configuration
    this.retryOptions = {
      maxRetries: 3,
      baseDelay: 1000,   // 1 second base delay
      maxDelay: 8000     // 8 seconds max delay
    };

    console.log('✅ Rate limiter configured: 10 tokens, 2 refills/second');
    console.log('✅ Retry logic configured: 3 max retries, exponential backoff\n');
  }

  // Demo: Rate limiting in action
  async demonstrateRateLimiting() {
    console.log('📊 Demonstrating Rate Limiting...');
    console.log('Making 15 requests with rate limiting enabled:\n');

    const startTime = Date.now();
    const promises = [];

    for (let i = 1; i <= 15; i++) {
      promises.push(this.makeRateLimitedRequest(i));
    }

    await Promise.all(promises);
    const duration = Date.now() - startTime;

    console.log(`\n⏱️  All 15 requests completed in ${duration}ms`);
    console.log('✅ Rate limiting prevented server overload\n');
  }

  async makeRateLimitedRequest(requestId) {
    // Simulate rate limiting check
    if (this.rateLimiter.tokens <= 0) {
      const waitTime = Math.ceil(1000 / this.rateLimiter.refillRate);
      console.log(`⏳ Request ${requestId}: Waiting ${waitTime}ms for rate limit...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.rateLimiter.tokens = Math.max(0, this.rateLimiter.tokens - 1);

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 50));
    console.log(`✅ Request ${requestId}: Completed`);

    // Refill tokens
    setTimeout(() => {
      this.rateLimiter.tokens = Math.min(this.rateLimiter.maxTokens, this.rateLimiter.tokens + 1);
    }, 500);
  }

  // Demo: Parallel fetching optimization
  async demonstrateParallelFetching() {
    console.log('🔄 Demonstrating Parallel Fetching...');
    console.log('Comparing sequential vs parallel fetching:\n');

    // Sequential approach (old way)
    console.log('📈 Sequential fetching:');
    const sequentialStart = Date.now();

    await this.fetchProjectInfo();
    await this.fetchTags();
    await this.fetchBranches();
    await this.fetchReadme();

    const sequentialTime = Date.now() - sequentialStart;
    console.log(`⏱️  Sequential: ${sequentialTime}ms\n`);

    // Parallel approach (optimized)
    console.log('⚡ Parallel fetching:');
    const parallelStart = Date.now();

    await Promise.all([
      this.fetchProjectInfo(),
      this.fetchTags(),
      this.fetchBranches(),
      this.fetchReadme()
    ]);

    const parallelTime = Date.now() - parallelStart;
    console.log(`⏱️  Parallel: ${parallelTime}ms`);

    const improvement = Math.round(((sequentialTime - parallelTime) / sequentialTime) * 100);
    console.log(`🚀 Performance improvement: ${improvement}%\n`);
  }

  async fetchProjectInfo() {
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log('  ✅ Project info fetched');
  }

  async fetchTags() {
    await new Promise(resolve => setTimeout(resolve, 150));
    console.log('  ✅ Tags fetched');
  }

  async fetchBranches() {
    await new Promise(resolve => setTimeout(resolve, 120));
    console.log('  ✅ Branches fetched');
  }

  async fetchReadme() {
    await new Promise(resolve => setTimeout(resolve, 80));
    console.log('  ✅ README fetched');
  }

  // Demo: Pagination handling
  async demonstratePagination() {
    console.log('📄 Demonstrating Pagination Handling...');
    console.log('Fetching all pages of results automatically:\n');

    const results = await this.fetchAllPages();

    console.log(`✅ Successfully fetched ${results.length} items across multiple pages`);
    console.log(`📊 Items per page: 3, Total pages: ${Math.ceil(results.length / 3)}`);
    console.log(`🔍 Sample results: ${results.slice(0, 3).map(r => r.name).join(', ')}\n`);
  }

  async fetchAllPages() {
    const allResults = [];
    let page = 1;
    let hasMore = true;
    const perPage = 3;

    // Mock data representing paginated API responses
    const mockData = [
      { id: 1, name: 'v1.0.0' }, { id: 2, name: 'v1.1.0' }, { id: 3, name: 'v1.2.0' },
      { id: 4, name: 'v2.0.0' }, { id: 5, name: 'v2.1.0' }, { id: 6, name: 'v2.2.0' },
      { id: 7, name: 'main' }, { id: 8, name: 'develop' }
    ];

    while (hasMore) {
      console.log(`📄 Fetching page ${page}...`);

      // Simulate API call delay
      await new Promise(resolve => setTimeout(resolve, 80));

      const startIndex = (page - 1) * perPage;
      const pageResults = mockData.slice(startIndex, startIndex + perPage);

      if (pageResults.length > 0) {
        allResults.push(...pageResults);
        console.log(`  ✅ Page ${page}: ${pageResults.length} items`);

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

  // Demo: Retry logic with exponential backoff
  async demonstrateRetryLogic() {
    console.log('🔄 Demonstrating Retry Logic...');
    console.log('Simulating API failures with automatic retry:\n');

    let attempt = 0;

    const result = await this.fetchWithRetry(async () => {
      attempt++;
      console.log(`🔍 Attempt ${attempt}:`);

      if (attempt <= 2) {
        console.log(`  ❌ Simulated failure (Rate limited: 429)`);
        throw new Error('RATE_LIMITED:429');
      }

      console.log(`  ✅ Success!`);
      return { success: true, attempt };
    });

    console.log(`\n🎉 Request succeeded after ${result.attempt} attempts`);
    console.log('✅ Exponential backoff prevented aggressive retries\n');
  }

  async fetchWithRetry(requestFn) {
    let lastError;

    for (let attempt = 0; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error;

        const isRateLimited = error?.message?.includes('RATE_LIMITED');

        if (attempt < this.retryOptions.maxRetries && isRateLimited) {
          const delay = Math.min(
            this.retryOptions.baseDelay * Math.pow(2, attempt),
            this.retryOptions.maxDelay
          );

          console.log(`  ⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        break;
      }
    }

    throw lastError;
  }
}

// Run the demonstration
async function runDemo() {
  const service = new OptimizedComponentService();

  try {
    await service.demonstrateRateLimiting();
    await service.demonstrateParallelFetching();
    await service.demonstratePagination();
    await service.demonstrateRetryLogic();

    console.log('🎉 ComponentService Optimization Demo Completed!');
    console.log('\n📋 Summary of Benefits:');
    console.log('✅ Rate limiting prevents API abuse and server overload');
    console.log('✅ Parallel fetching reduces response times by up to 70%');
    console.log('✅ Pagination ensures complete data retrieval');
    console.log('✅ Retry logic handles transient failures gracefully');
    console.log('✅ All optimizations work together seamlessly');

  } catch (error) {
    console.error('❌ Demo failed:', error.message);
  }
}

// Run the demo
runDemo();
