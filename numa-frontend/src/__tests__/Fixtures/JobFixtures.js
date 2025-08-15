/**
 * Test fixtures for job-related tests
 */

export const jobFixtures = {
  validJobs: {
    items: [
      {
        jobId: 'job-1',
        appId: 'meeting-analyser',
        status: 'completed',
        startedAt: '2025-08-13T20:00:00Z',
        completedAt: '2025-08-13T20:05:30Z',
        lastUpdated: '2025-08-13T20:05:30Z',
        dateTime: '2025-08-13T20:00:00Z',
        duration: 330, // 5 minutes and 30 seconds
        name: 'Test Job 1',
        description: 'Test job description',
      },
      {
        jobId: 'job-2',
        appId: 'meeting-analyser',
        status: 'failed',
        startedAt: '2025-08-13T21:00:00Z',
        completedAt: null,
        lastUpdated: '2025-08-13T21:01:15Z',
        dateTime: '2025-08-13T21:00:00Z',
        duration: null,
        name: 'Test Job 2',
        description: 'Test job with error',
      },
      {
        jobId: 'job-3',
        appId: 'meeting-analyser',
        status: 'running',
        startedAt: '2025-08-13T22:00:00Z',
        completedAt: null,
        lastUpdated: '2025-08-13T22:01:00Z',
        dateTime: '2025-08-13T22:00:00Z',
        duration: null,
        name: 'Test Job 3',
        description: 'Test job in progress',
      },
      {
        jobId: 'job-4',
        appId: 'meeting-analyser',
        status: 'files-uploaded',
        startedAt: null,
        completedAt: null,
        lastUpdated: '2025-08-13T23:00:00Z',
        dateTime: '2025-08-13T23:00:00Z',
        duration: null,
        name: 'Test Job 4',
        description: 'Test job with files uploaded',
      },
    ],
    nextToken: null,
  },
  emptyJobs: {
    items: [],
    nextToken: null,
  },
  jobsWithNextToken: {
    items: [
      {
        jobId: 'job-5',
        appId: 'meeting-analyser',
        status: 'completed',
        startedAt: '2025-08-12T20:00:00Z',
        completedAt: '2025-08-12T20:02:15Z',
        lastUpdated: '2025-08-12T20:02:15Z',
        dateTime: '2025-08-12T20:00:00Z',
        duration: 135, // 2 minutes and 15 seconds
        name: 'Test Job 5',
        description: 'Older test job',
      },
    ],
    nextToken: 'next-page-token',
  },
};
