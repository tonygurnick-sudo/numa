#!/usr/bin/env node
/**
 * Seed script: generates 30 days of login activity for 5 test users.
 * Each user has a distinct usage pattern so the heatmap looks interesting.
 *
 * Usage:
 *   API_KEY=numa_xxx node ai-workspace/seed-login-heatmap.mjs
 *
 * Or pass directly:
 *   node ai-workspace/seed-login-heatmap.mjs numa_xxx
 */

const API_KEY = process.argv[2] || process.env.API_KEY;
const BASE_URL = 'https://arcanum-demo-tony.numa.arcanum.ai/api';

if (!API_KEY) {
  console.error('ERROR: API key required. Pass as first argument or set API_KEY env var.');
  console.error('  node ai-workspace/seed-login-heatmap.mjs numa_xxxx');
  process.exit(1);
}

// 5 test users with distinct activity patterns
const USERS = [
  {
    userId: 'user-alice-0001-0001-000000000001',
    userName: 'Alice Johnson',
    name: 'Alice (power user)',
    // Logs in 2-4 times most days
    dailyPattern: () => (Math.random() < 0.9 ? Math.floor(Math.random() * 3) + 2 : 0),
  },
  {
    userId: 'user-bob-00002-0001-000000000002',
    userName: 'Bob Smith',
    name: 'Bob (regular)',
    // Logs in once most weekdays, rarely on weekends
    dailyPattern: (date) => {
      const day = new Date(date).getDay(); // 0=Sun, 6=Sat
      if (day === 0 || day === 6) return Math.random() < 0.1 ? 1 : 0;
      return Math.random() < 0.8 ? 1 : 0;
    },
  },
  {
    userId: 'user-carol-003-0001-000000000003',
    userName: 'Carol Williams',
    name: 'Carol (occasional)',
    // Bursts of activity, then nothing for days
    dailyPattern: (date, weekIndex) => {
      // Active weeks 1 and 3, quiet otherwise
      if (weekIndex % 2 === 0) return Math.random() < 0.3 ? 1 : 0;
      return Math.random() < 0.7 ? Math.floor(Math.random() * 2) + 1 : 0;
    },
  },
  {
    userId: 'user-david-004-0001-000000000004',
    userName: 'David Brown',
    name: 'David (heavy end of month)',
    // Login count increases toward end of month
    dailyPattern: (date, _, dayIndex, totalDays) => {
      const weight = dayIndex / totalDays; // 0 at start, 1 at end
      const base = Math.random();
      return base < weight * 0.9 ? Math.floor(Math.random() * 3) + 1 : 0;
    },
  },
  {
    userId: 'user-eve-00005-0001-000000000005',
    userName: 'Eve Taylor',
    name: 'Eve (erratic)',
    // Random spikes — some days 5+ logins, many days zero
    dailyPattern: () => {
      const r = Math.random();
      if (r < 0.5) return 0;
      if (r < 0.8) return 1;
      if (r < 0.95) return 3;
      return Math.floor(Math.random() * 5) + 4; // spike
    },
  },
];

const DAYS = 30;

/**
 * Generate UUID v4 (no dependencies — just crypto.randomUUID)
 */
const uuid = () => crypto.randomUUID();

/**
 * Build a timestamp for a given date, adding a random offset within the day
 */
const timestampForDate = (isoDate) => {
  const base = new Date(isoDate + 'T00:00:00.000Z').getTime();
  const jitter = Math.floor(Math.random() * 86400 * 1000); // random time within day
  return base + jitter;
};

/**
 * POST a single login event
 */
const ingest = async (event) => {
  const res = await fetch(`${BASE_URL}/usage-analytics/ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Analytics-API-Key': API_KEY,
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  return res.json();
};

/**
 * Build date range: last `days` days ending today
 */
const buildDates = (days) => {
  const dates = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
};

const main = async () => {
  const dates = buildDates(DAYS);
  let totalSent = 0;
  let totalFailed = 0;

  console.log(`Seeding ${DAYS} days of login data for ${USERS.length} users...`);
  console.log(`Endpoint: ${BASE_URL}/usage-analytics/ingest\n`);

  for (const user of USERS) {
    let userCount = 0;
    process.stdout.write(`  ${user.name}: `);

    for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
      const date = dates[dayIndex];
      const weekIndex = Math.floor(dayIndex / 7);
      const logins = user.dailyPattern(date, weekIndex, dayIndex, dates.length);

      for (let i = 0; i < logins; i++) {
        const event = {
          eventType: 'login',
          eventId: uuid(),
          timestamp: timestampForDate(date),
          isTest: true,
          userId: user.userId,
          userName: user.userName,
          source: 'seed-script',
          eventData: {
            loginMethod: 'cognito',
            success: true,
            userAgent: 'Mozilla/5.0 (seed-script)',
          },
        };

        try {
          await ingest(event);
          userCount++;
          totalSent++;
          process.stdout.write('.');
        } catch (e) {
          process.stdout.write('x');
          console.error(`\n    FAILED (${date}): ${e.message}`);
          totalFailed++;
        }

        // Small delay to avoid hammering API Gateway
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    console.log(` ${userCount} events`);
  }

  console.log(`\nDone. Sent: ${totalSent}, Failed: ${totalFailed}`);
  console.log('All events marked isTest=true — delete them any time from the Audit tab.');
};

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
