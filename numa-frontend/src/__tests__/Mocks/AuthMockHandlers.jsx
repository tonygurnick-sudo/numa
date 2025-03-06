import { ListDataSourcesCommand, ListDataSourceSyncJobsCommand } from '@aws-sdk/client-qbusiness';

const Q_DATASOURCE_ID = window.sessionStorage.getItem('Q_DATASOURCE_ID');

// Mock data for QBusiness responses
const mockDataSource = {
  dataSources: [
    {
      dataSourceId: Q_DATASOURCE_ID,
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

export const clearAuthMocks = () => {
  Object.values(authHandlers).forEach((handler) => {
    if (typeof handler === 'function') {
      handler.mockReset();
    }
  });
};

// Update setupAuthMocks to return the handlers
export const setupAuthMocks = () => {
  clearAuthMocks();
  return authHandlers;
};
