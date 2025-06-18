/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useJobsApi } from '../../Services/jobsApi';
import { NumaRequestContext } from '../../Providers/NumaRequestContext';
import { AuthProvider } from '../../Providers/AuthProvider';

// Mock sessionStorage
const sessionStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

global.sessionStorage = sessionStorageMock;

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

global.localStorage = localStorageMock;

// Mock the NumaRequestContext
const mockNumaGet = vi.fn();
const mockNumaPost = vi.fn();
const mockNumaPut = vi.fn();

// Test tokens for the new Groups pattern
const TEST_TOKENS = {
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.mock-signature',
  idToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTksInN1YiI6InRlc3QtdXNlci1pZCJ9.mock-signature',
  refreshToken: 'mock-refresh-token',
  decoded: {
    accessToken: { exp: 9999999999 },
    idToken: {
      exp: 9999999999,
      sub: 'test-user-id',
      'cognito:groups': [],
    },
  },
};

// Wrapper component for the hooks
const wrapper = ({ children }) => {
  // Setup sessionStorage mock
  sessionStorageMock.getItem.mockImplementation((key) => {
    switch (key) {
      case 'ROLE_ARN':
        return 'arn:aws:iam::123456789012:role/test-role';
      case 'USER_POOL_ID':
        return 'us-east-1_testpool';
      case 'API_ENDPOINT':
        return 'https://api.example.com';
      case 'CLIENT_ID':
        return 'test-client-id';
      case 'REGION':
        return 'us-east-1';
      case 'IDENTITY_POOL_ID':
        return 'us-east-1:test-identity-pool';
      case 'GROUPS':
        return JSON.stringify({
          admin: {
            roleArn: 'arn:aws:iam::123456789012:role/test-admin-role',
            features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
          },
          user: {
            roleArn: 'arn:aws:iam::123456789012:role/test-user-role',
            features: ['chat', 'useCompanyData'],
          },
        });
      default:
        return null;
    }
  });

  // Setup localStorage mock to return test tokens
  localStorageMock.getItem.mockImplementation((key) => {
    switch (key) {
      case 'refreshToken':
        return TEST_TOKENS.refreshToken;
      case 'idToken':
        return TEST_TOKENS.idToken;
      case 'accessToken':
        return TEST_TOKENS.accessToken;
      default:
        return null;
    }
  });

  return (
    <AuthProvider
      initialTokens={{
        tokens: {
          accessToken: TEST_TOKENS.accessToken,
          idToken: TEST_TOKENS.idToken,
          refreshToken: TEST_TOKENS.refreshToken,
        },
        decoded_tokens: TEST_TOKENS.decoded,
        groups: ['admin'],
        features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
      }}
    >
      <NumaRequestContext.Provider
        value={{
          numaGet: mockNumaGet,
          numaPost: mockNumaPost,
          numaPut: mockNumaPut,
        }}
      >
        {children}
      </NumaRequestContext.Provider>
    </AuthProvider>
  );
};

describe('jobsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createJob', () => {
    it('should create a job with the correct data', async () => {
      // Mock the numaPost response
      const mockJobId = 'new-job-id';
      mockNumaPost.mockResolvedValueOnce({ jobId: mockJobId, status: 'running' });

      // Mock the getJobById call that happens after create
      mockNumaGet.mockResolvedValueOnce({ jobId: mockJobId, status: 'running' });

      // Render the hook
      const { result } = renderHook(() => useJobsApi(), { wrapper });

      // Test data
      const numaAppData = { id: 'test-app', appName: 'Test App', type: 'test-type' };
      const taskInputs = { file: 'test.pdf' };

      // Call createJob
      await act(async () => {
        const response = await result.current.createJob(numaAppData, taskInputs);
        expect(response).toEqual({ jobId: mockJobId, status: 'running' });
      });

      // Check that numaPost was called with the correct parameters
      expect(mockNumaPost).toHaveBeenCalledTimes(1);
      const call = mockNumaPost.mock.calls[0];
      expect(call[0]).toBe(`/api/${numaAppData.id}/jobs`);
      expect(call[1]).toMatchObject({
        appName: numaAppData.appName,
        appType: numaAppData.type,
        inputs: taskInputs,
        status: 'running',
        manifest: JSON.stringify(numaAppData),
        userId: 'test-user-id',
      });
      expect(call[1]).toHaveProperty('startedAt');
      expect(call[1]).toHaveProperty('lastUpdated');
      expect(call[1]).toHaveProperty('name');
      expect(call[1]).toHaveProperty('results', null);
    });
  });

  describe('getJobById', () => {
    it('should fetch a job by ID', async () => {
      // Mock the numaGet response
      const mockJob = { jobId: 'test-job-id', status: 'completed', results: { output: 'test' } };
      mockNumaGet.mockResolvedValueOnce(mockJob);

      // Render the hook
      const { result } = renderHook(() => useJobsApi(), { wrapper });

      // Test data
      const numaAppId = 'test-app';
      const jobId = 'test-job-id';

      // Call getJobById with userId
      const userId = 'test-user-id';
      await act(async () => {
        const response = await result.current.getJobById(numaAppId, jobId, userId);
        expect(response).toEqual(mockJob);
      });

      // Check that numaGet was called with the correct parameters
      expect(mockNumaGet).toHaveBeenCalledTimes(1);
      expect(mockNumaGet).toHaveBeenCalledWith(`/api/${numaAppId}/jobs/${jobId}`, {
        userId: 'test-user-id',
      });
    });
  });

  describe('getJobsByAppId', () => {
    it('should fetch jobs by app ID with default parameters', async () => {
      // Mock the numaGet response
      const mockJobs = {
        items: [
          { jobId: 'job-1', status: 'completed' },
          { jobId: 'job-2', status: 'running' },
        ],
        next_token: null,
        count: 2,
      };
      mockNumaGet.mockResolvedValueOnce(mockJobs);

      // Render the hook
      const { result } = renderHook(() => useJobsApi(), { wrapper });

      // Test data
      const numaAppId = 'test-app';

      // Call getJobsByAppId
      await act(async () => {
        const response = await result.current.getJobsByAppId(numaAppId);
        // The implementation returns nextToken as null and next_token as the actual value
        expect(response).toEqual({
          items: mockJobs.items,
          nextToken: null,
          next_token: mockJobs.next_token,
          count: mockJobs.count,
        });
      });

      // Check that numaGet was called with the correct parameters and headers
      expect(mockNumaGet).toHaveBeenCalledTimes(1);
      expect(mockNumaGet).toHaveBeenCalledWith(`/api/${numaAppId}/jobs`, {
        limit: 50, // Default limit in the implementation
        userId: 'test-user-id',
      });
    });

    it('should fetch jobs by app ID with custom parameters', async () => {
      // Mock the numaGet response
      const mockJobs = {
        items: [{ jobId: 'job-1', status: 'completed' }],
        next_token: 'next-token-value',
        count: 1,
      };
      mockNumaGet.mockResolvedValueOnce(mockJobs);

      // Render the hook
      const { result } = renderHook(() => useJobsApi(), { wrapper });

      // Test data
      const numaAppId = 'test-app';
      const nextToken = 'token';

      // Call getJobsByAppId with nextToken
      await act(async () => {
        const response = await result.current.getJobsByAppId(numaAppId, nextToken);
        // The implementation returns nextToken as null and next_token as the actual value
        expect(response).toEqual({
          items: mockJobs.items,
          nextToken: null,
          next_token: mockJobs.next_token,
          count: mockJobs.count,
        });
      });

      // Check that numaGet was called with the correct parameters and headers
      expect(mockNumaGet).toHaveBeenCalledTimes(1);
      expect(mockNumaGet).toHaveBeenCalledWith(`/api/${numaAppId}/jobs`, {
        limit: 50, // The implementation uses a default limit of 50
        nextToken: '"token"', // The implementation stringifies the nextToken
        userId: 'test-user-id',
      });
    });
  });

  describe('updateJob', () => {
    it('should only update provided fields', async () => {
      // Mock the numaPut response
      mockNumaPut.mockResolvedValueOnce({ success: true });

      // Mock the getJobById call that happens after update
      mockNumaGet.mockResolvedValueOnce({ jobId: 'test-job-id', status: 'completed' });

      // Render the hook
      const { result } = renderHook(() => useJobsApi(), { wrapper });

      // Test data
      const numaAppData = { id: 'test-app' };
      const jobId = 'test-job-id';
      const results = { output: 'test-output' };

      // Call updateJob with only results and status
      const userId = 'test-user-id';
      await act(async () => {
        await result.current.updateJob(numaAppData, jobId, results, undefined, 'completed', userId);
      });

      // Check that numaPut was called with the correct parameters and headers
      expect(mockNumaPut).toHaveBeenCalledTimes(1);
      const call = mockNumaPut.mock.calls[0];
      expect(call[0]).toBe(`/api/${numaAppData.id}/jobs/${jobId}`);
      expect(call[1]).toMatchObject({
        results: {
          output: 'test-output',
        },
        status: 'completed',
      });
      expect(call[1]).toHaveProperty('lastUpdated');
      expect(call[1]).toHaveProperty('name');

      // Verify inputs is not in the update data
      const updateData = mockNumaPut.mock.calls[0][1];
      expect(updateData).not.toHaveProperty('inputs');
    });

    it('should update only status when only status is provided', async () => {
      // Mock the numaPut response
      mockNumaPut.mockResolvedValueOnce({ success: true });

      // Mock the getJobById call that happens after update
      mockNumaGet.mockResolvedValueOnce({ jobId: 'test-job-id', status: 'completed' });

      // Render the hook
      const { result } = renderHook(() => useJobsApi(), { wrapper });

      // Test data
      const numaAppData = { id: 'test-app' };
      const jobId = 'test-job-id';

      // Call updateJob with only status and userId
      const userId = 'test-user-id';
      await act(async () => {
        await result.current.updateJob(numaAppData, jobId, undefined, undefined, 'completed', userId);
      });

      // Check that numaPut was called with the correct parameters and headers
      expect(mockNumaPut).toHaveBeenCalledTimes(1);
      const call = mockNumaPut.mock.calls[0];
      expect(call[0]).toBe(`/api/${numaAppData.id}/jobs/${jobId}`);
      expect(call[1]).toMatchObject({
        status: 'completed',
      });
      expect(call[1]).toHaveProperty('lastUpdated');
      expect(call[1]).toHaveProperty('name');

      // Verify results and inputs are not in the update data
      const updateData = mockNumaPut.mock.calls[0][1];
      expect(updateData).not.toHaveProperty('results');
      expect(updateData).not.toHaveProperty('inputs');
    });

    it('should update only inputs when only inputs is provided', async () => {
      // Mock the numaPut response
      mockNumaPut.mockResolvedValueOnce({ success: true });

      // Mock the getJobById call that happens after update
      mockNumaGet.mockResolvedValueOnce({ jobId: 'test-job-id', inputs: { file: 'test.pdf' } });

      // Render the hook
      const { result } = renderHook(() => useJobsApi(), { wrapper });

      // Test data
      const numaAppData = { id: 'test-app' };
      const jobId = 'test-job-id';
      const inputs = { file: 'test.pdf' };

      // Call updateJob with only inputs and userId
      const userId = 'test-user-id';
      await act(async () => {
        await result.current.updateJob(numaAppData, jobId, undefined, inputs, undefined, userId);
      });

      // Check that numaPut was called with the correct parameters and headers
      expect(mockNumaPut).toHaveBeenCalledTimes(1);
      const call = mockNumaPut.mock.calls[0];
      expect(call[0]).toBe(`/api/${numaAppData.id}/jobs/${jobId}`);
      expect(call[1]).toMatchObject({
        inputs: {
          file: 'test.pdf',
        },
      });
      expect(call[1]).toHaveProperty('lastUpdated');
      expect(call[1]).toHaveProperty('name');
      expect(call[1]).toHaveProperty('status');

      // Verify results is not in the update data
      const updateData = mockNumaPut.mock.calls[0][1];
      expect(updateData).not.toHaveProperty('results');

      // in the updateJob function when undefined is passed
      expect(updateData.status).toBe('running');
    });
  });
});
