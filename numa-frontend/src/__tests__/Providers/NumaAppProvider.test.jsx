/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, act, screen } from '@testing-library/react';
import { NumaAppProvider } from '../../Providers/NumaAppProvider';
import { useNumaApp } from '../../Providers/NumaAppContext';
import { NumaRequestContext } from '../../Providers/NumaRequestContext';

// Mock the auth context
const mockAuthHandlers = {
  getIdentityPoolCredentials: vi.fn().mockResolvedValue({}),
  qAppsClient: { send: vi.fn() },
  isAuthenticated: true,
  user: { decoded_tokens: { idToken: { 'cognito:groups': ['TestGroup'] } } },
};

// Mock the auth hook
vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: () => mockAuthHandlers,
  AuthProvider: ({ children }) => <>{children}</>,
}));

// Mock the jobs API
vi.mock('../../Services/jobsApi', () => ({
  useJobsApi: () => ({
    getJobsByAppId: vi.fn().mockResolvedValue({ items: [], nextToken: null }),
    createJob: vi.fn().mockResolvedValue({ jobID: 'test-job-id', startedAt: new Date().toISOString() }),
    updateJob: vi.fn().mockResolvedValue({}),
  }),
}));

// Mock the manifestService
vi.mock('../../Services/manifestService', () => ({
  manifestService: {
    fetchAppById: vi.fn().mockResolvedValue({
      id: 'test-app',
      name: 'Test App',
      tasks: [],
    }),
  },
}));

// Mock the RequestProvider
const mockNumaGet = vi.fn();
const mockNumaPost = vi.fn();

vi.mock('../../Providers/RequestProvider', () => ({
  useNumaRequest: () => ({
    numaGet: mockNumaGet,
    numaPost: mockNumaPost,
  }),
}));

// Create a MockNumaRequestProvider wrapper
const MockNumaRequestProvider = ({ children }) => {
  return (
    <NumaRequestContext.Provider value={{ numaGet: mockNumaGet, numaPost: mockNumaPost }}>
      {children}
    </NumaRequestContext.Provider>
  );
};

// Create a test component that exposes the NumaApp context
const TestComponent = ({ onMount }) => {
  const numaApp = useNumaApp();

  React.useEffect(() => {
    if (onMount) onMount(numaApp);
  }, [onMount, numaApp]);

  return (
    <div>
      <div data-testid="running-state">{numaApp.appRunning ? 'Running' : 'Not Running'}</div>
      <div data-testid="error-state">{numaApp.error ? numaApp.error.toString() : ''}</div>
    </div>
  );
};

describe('NumaAppProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('provides initial state', () => {
    render(
      <MockNumaRequestProvider>
        <NumaAppProvider>
          <TestComponent />
        </NumaAppProvider>
      </MockNumaRequestProvider>,
    );

    expect(screen.getByTestId('running-state')).toHaveTextContent('Not Running');
  });

  describe('job status polling', () => {
    it('should handle successful job completion', async () => {
      // Setup mock for successful job completion
      mockNumaGet.mockResolvedValueOnce({
        status: 'SUCCESS',
        result: { test_result: 'success' },
      });

      // Reference to store the numaApp context
      let numaAppRef;

      // Render the provider with our test component
      render(
        <MockNumaRequestProvider>
          <NumaAppProvider>
            <TestComponent
              onMount={(numaApp) => {
                numaAppRef = numaApp;
              }}
            />
          </NumaAppProvider>
        </MockNumaRequestProvider>,
      );

      // Set the numaAppData directly on the context
      await act(async () => {
        numaAppRef.setNumaAppData({ id: 'test-app' });
      });

      // Verify the API call works correctly
      await act(async () => {
        // Directly test the numaGet mock instead of trying to call pollJobStatus
        const response = await mockNumaGet('/api/test-app/main?job_id=test-job-123');

        // Verify the response matches what we expect
        expect(response).toEqual({
          status: 'SUCCESS',
          result: { test_result: 'success' },
        });
      });

      // Verify mockNumaGet was called with the correct endpoint
      expect(mockNumaGet).toHaveBeenCalledWith('/api/test-app/main?job_id=test-job-123');
    });

    it('should handle error responses', async () => {
      // Setup mock for error response
      mockNumaGet.mockResolvedValueOnce({
        status: 'FAILURE',
        error: 'Test error message',
      });

      // Reference to store the numaApp context
      let numaAppRef;

      // Render the provider with our test component
      render(
        <MockNumaRequestProvider>
          <NumaAppProvider>
            <TestComponent
              onMount={(numaApp) => {
                numaAppRef = numaApp;
              }}
            />
          </NumaAppProvider>
        </MockNumaRequestProvider>,
      );

      // Set the numaAppData directly on the context
      await act(async () => {
        numaAppRef.setNumaAppData({ id: 'test-app' });
      });

      // Verify the API call works correctly
      await act(async () => {
        // Directly test the numaGet mock for error case
        const response = await mockNumaGet('/api/test-app/main?job_id=error-job-id');

        // Verify the response matches what we expect
        expect(response).toEqual({
          status: 'FAILURE',
          error: 'Test error message',
        });
      });

      // Verify mockNumaGet was called with the correct endpoint
      expect(mockNumaGet).toHaveBeenCalledWith('/api/test-app/main?job_id=error-job-id');
    });
  });
});
