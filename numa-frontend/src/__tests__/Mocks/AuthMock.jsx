import { vi } from 'vitest';
import React from 'react';

// Define handlers first
export const authHandlers = {
  logout: vi.fn(),
  requestPasswordReset: vi.fn(),
  confirmPasswordReset: vi.fn(),
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
  // Reset all handlers to their initial state
  authHandlers.logout.mockReset();
  authHandlers.requestPasswordReset.mockReset();
  authHandlers.confirmPasswordReset.mockReset();
  return authHandlers;
};

export const clearAuthMocks = () => {
  authHandlers.logout.mockReset();
  authHandlers.requestPasswordReset.mockReset();
  authHandlers.confirmPasswordReset.mockReset();
};
