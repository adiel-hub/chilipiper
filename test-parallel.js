/**
 * Parallel API Load Test
 * Tests the scraper's accuracy and reliability under load
 */

const API_URL = 'http://localhost:3000/api/get-slots';
const NUM_REQUESTS = 1;

const testRequest = {
  chili_piper_url: "https://cincpro.chilipiper.com/concierge-router/link/lp-request-a-demo-agent-advice",
  max_days: "3",
  max_slots_per_day: "5",
  max_slots: "5",
  email: "test@example.com",
  timezone: "America/New_York",
  custom_params: {
    phone: "+1122112121",
    firstname: "adiel",
    lastname: "halevi"
  }
};

async function makeRequest(id) {
  const startTime = Date.now();
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(testRequest),
    });

    const duration = Date.now() - startTime;
    const data = await response.json();

    return {
      id,
      success: response.ok,
      status: response.status,
      duration,
      slotsFound: data.data?.total_slots || 0,
      daysFound: data.data?.total_days || 0,
      error: data.error?.message || null,
      code: data.code || null,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    return {
      id,
      success: false,
      status: 0,
      duration,
      slotsFound: 0,
      daysFound: 0,
      error: error.message,
      code: 'NETWORK_ERROR',
    };
  }
}

async function runLoadTest() {
  console.log(`🚀 Starting parallel load test with ${NUM_REQUESTS} requests...\n`);
  console.log(`📍 Target: ${API_URL}`);
  console.log(`🌐 URL: ${testRequest.chili_piper_url}\n`);

  const startTime = Date.now();

  // Create all requests
  const requests = Array.from({ length: NUM_REQUESTS }, (_, i) => makeRequest(i + 1));

  // Run all requests in parallel
  const results = await Promise.all(requests);

  const totalDuration = Date.now() - startTime;

  // Analyze results
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const minDuration = Math.min(...results.map(r => r.duration));
  const maxDuration = Math.max(...results.map(r => r.duration));

  // Group by error type
  const errorCounts = {};
  failed.forEach(r => {
    const errorKey = r.code || r.error || 'UNKNOWN';
    errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
  });

  // Group by slots found (for successful requests)
  const slotCounts = {};
  successful.forEach(r => {
    slotCounts[r.slotsFound] = (slotCounts[r.slotsFound] || 0) + 1;
  });

  // Print results
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📊 LOAD TEST RESULTS');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('⏱️  TIMING:');
  console.log(`   Total Duration:    ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`   Average per call:  ${(avgDuration / 1000).toFixed(2)}s`);
  console.log(`   Fastest:           ${(minDuration / 1000).toFixed(2)}s`);
  console.log(`   Slowest:           ${(maxDuration / 1000).toFixed(2)}s`);
  console.log(`   Requests/second:   ${(NUM_REQUESTS / (totalDuration / 1000)).toFixed(2)}\n`);

  console.log('✅ SUCCESS RATE:');
  console.log(`   Successful: ${successful.length}/${NUM_REQUESTS} (${((successful.length / NUM_REQUESTS) * 100).toFixed(1)}%)`);
  console.log(`   Failed:     ${failed.length}/${NUM_REQUESTS} (${((failed.length / NUM_REQUESTS) * 100).toFixed(1)}%)\n`);

  if (successful.length > 0) {
    console.log('📅 SLOTS FOUND (Successful Requests):');
    Object.entries(slotCounts)
      .sort(([a], [b]) => Number(b) - Number(a))
      .forEach(([slots, count]) => {
        const percentage = ((count / successful.length) * 100).toFixed(1);
        console.log(`   ${slots} slots: ${count} requests (${percentage}%)`);
      });
    console.log();
  }

  if (failed.length > 0) {
    console.log('❌ ERROR BREAKDOWN:');
    Object.entries(errorCounts)
      .sort(([, a], [, b]) => b - a)
      .forEach(([error, count]) => {
        const percentage = ((count / failed.length) * 100).toFixed(1);
        console.log(`   ${error}: ${count} (${percentage}%)`);
      });
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════');

  // Sample failed requests
  if (failed.length > 0 && failed.length <= 10) {
    console.log('\n🔍 FAILED REQUESTS DETAILS:');
    failed.forEach(r => {
      console.log(`   Request #${r.id}: ${r.error || r.code} (${r.duration}ms)`);
    });
  }

  // Sample successful requests
  if (successful.length > 0 && successful.length <= 10) {
    console.log('\n✨ SUCCESSFUL REQUESTS DETAILS:');
    successful.slice(0, 5).forEach(r => {
      console.log(`   Request #${r.id}: ${r.slotsFound} slots, ${r.daysFound} days (${r.duration}ms)`);
    });
  }

  console.log();
}

// Run the test
runLoadTest().catch(console.error);
