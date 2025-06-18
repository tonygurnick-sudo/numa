import { ListDataSourcesCommand, ListDataSourceSyncJobsCommand } from '@aws-sdk/client-qbusiness';

// Mock data for QBusiness responses
const mockDataSource = {
  dataSources: [
    {
      dataSourceId: 'mock-data-source-id',
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

// Define different user types
const createMockUser = (userType) => {
  const baseUser = {
    decoded_tokens: {
      idToken: {
        'cognito:groups': ['TestGroup'],
      },
    },
  };

  switch (userType) {
    case 'admin':
      return {
        ...baseUser,
        features: ['addToCompanyData', 'deleteFromCompanyData', 'chat', 'manageUsers', 'useCompanyData'],
      };
    default: // standard user
      return {
        ...baseUser,
        features: ['chat', 'useCompanyData', 'addToCompanyData'],
      };
  }
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
  tokenValidationComplete: true,
  error: null,
  user: createMockUser('standard'), // Default to standard user
  qBusinessClient: mockQBusinessClient,
  newPasswordRequired: false,
};

export const clearAuthMocks = () => {
  Object.values(authHandlers).forEach((handler) => {
    if (typeof handler === 'function') {
      handler.mockReset();
    }
  });
  // Reset to standard user
  authHandlers.user = createMockUser('standard');
};

// Update setupAuthMocks to return the handlers and allow setting user type
export const setupAuthMocks = (userType = 'standard') => {
  clearAuthMocks();
  authHandlers.user = createMockUser(userType);
  return authHandlers;
};

// Helper functions to set different user types during tests
export const setMockUser = (userType) => {
  authHandlers.user = createMockUser(userType);
};

export const getMockAdminUser = () => createMockUser('admin');
export const getMockStandardUser = () => createMockUser('standard');
