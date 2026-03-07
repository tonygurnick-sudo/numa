#!/usr/bin/env node
/**
 * Quick smoke test — sends ONE login event through the CloudFront URL.
 * Verifies x-analytics-api-key is forwarded correctly after the cache policy fix.
 *
 * Usage:
 *   node ai-workspace/test-ingest.mjs <api-key>
 */

const API_KEY = process.argv[2] || process.env.API_KEY;
const BASE_URL = 'https://arcanum-demo-tony.numa.arcanum.ai/api';

if (!API_KEY) {
  console.error('ERROR: API key required.');
  console.error('  node ai-workspace/test-ingest.mjs numa_xxxx');
  process.exit(1);
}

const event = {
  eventType: 'login',
  eventId: crypto.randomUUID(),
  timestamp: Date.now(),
  isTest: true,
  userId: 'test-user-smoke-001',
  source: 'smoke-test',
  eventData: { loginMethod: 'cognito', success: true },
};

console.log(`POST ${BASE_URL}/usage-analytics/ingest`);
console.log(`Key:  ${API_KEY.slice(0, 12)}...`);
console.log(`Body: ${JSON.stringify(event)}\n`);

const res = await fetch(`${BASE_URL}/usage-analytics/ingest`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Analytics-API-Key': API_KEY,
  },
  body: JSON.stringify(event),
});

const body = await res.text();
console.log(`Status: ${res.status}`);
console.log(`Body:   ${body}`);

if (!res.ok) process.exit(1);
