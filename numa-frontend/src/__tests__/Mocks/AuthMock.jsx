import { vi } from 'vitest';
import React from 'react';

// Define mock QBusinessClient
const mockQBusinessClient = {
  send: vi.fn(),
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
  isAuthenticated: false,
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
