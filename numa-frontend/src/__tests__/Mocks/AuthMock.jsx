import { vi } from 'vitest';
import React from 'react';
import { authHandlers } from './AuthMockHandlers';

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
