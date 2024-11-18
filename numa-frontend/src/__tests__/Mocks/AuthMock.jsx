import { vi } from 'vitest';
import React from 'react';
import {
  ListDataSourcesCommand,
  ListDataSourceSyncJobsCommand,
} from '@aws-sdk/client-qbusiness';

// Mock data for QBusiness responses
const mockDataSource = {
  dataSources: [
    {
      dataSourceId: 'b5a0cf1e-99a8-4a74-b92c-3b0103a3b5b0',
      status: 'ACTIVE',
      updatedAt: new Date(),
    },
  ],
};

const mockSyncJobs = {
  history: [
    {
      status: 'SUCCEEDED',
      endTime: new Date(),
      startTime: new Date(),
      metrics: {},
    },
  ],
};

// Define mock QBusinessClient with specific command handling
const mockQBusinessClient = {
  send: vi.fn().mockImplementation((command) => {
    if (command instanceof ListDataSourcesCommand) {
      return Promise.resolve(mockDataSource);
    }
    if (command instanceof ListDataSourceSyncJobsCommand) {
      return Promise.resolve(mockSyncJobs);
    }
    return Promise.resolve({});
  }),
};

// Define all auth handlers
export const authHandlers = {
  logout: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
  login: vi.fn(),
  setNewPassword: vi.fn(),
  setError: vi.fn(),
  setLoading: vi.fn(),
  setNewPasswordRequired: vi.fn(),
  getAccessToken: vi.fn().mockResolvedValue('mock-token'),
  isAuthenticated: true,
  loading: false,
  error: null,
  user: {
    decoded_tokens: {
      idToken: {
        'cognito:groups': ['TestGroup'],
      },
    },
  },
  qBusinessClient: mockQBusinessClient,
  newPasswordRequired: false,
};

// Create the actual mock context and provider
const AuthContext = React.createContext(authHandlers);

// Export the provider so we can use it in tests
export const MockAuthProvider = ({ children }) => (
  <AuthContext.Provider value={authHandlers}>{children}</AuthContext.Provider>
);

// Mock the module BEFORE any imports
vi.mock('../../Providers/AuthProvider', () => {
  return {
    __esModule: true,
    useAuth: () => authHandlers,
    AuthProvider: ({ children }) => children,
  };
});

// Update setupAuthMocks to return the handlers
export const setupAuthMocks = () => {
  clearAuthMocks();
  return authHandlers;
};

export const clearAuthMocks = () => {
  Object.values(authHandlers).forEach((handler) => {
    if (typeof handler === 'function') {
      handler.mockReset();
    }
  });
};
