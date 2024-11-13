import { vi } from 'vitest';
import React from 'react';

export const navigationHandlers = {
  mockNavigate: vi.fn(),
};

// Create Router context
const RouterContext = React.createContext(null);

// Create a mock MemoryRouter component that provides navigation context
export const MockMemoryRouter = ({ children }) => (
  <RouterContext.Provider
    value={{ navigator: { push: navigationHandlers.mockNavigate } }}
  >
    <div data-testid="mock-memory-router">{children}</div>
  </RouterContext.Provider>
);

// Mock the module BEFORE any imports
vi.mock('react-router-dom', () => {
  return {
    __esModule: true,
    useNavigate: () => navigationHandlers.mockNavigate,
    MemoryRouter: ({ children }) => children,
    useLocation: () => ({ pathname: '/' }),
    useParams: () => ({}),
  };
});

export const setupNavigationMocks = () => {
  return navigationHandlers;
};

export const clearNavigationMocks = () => {
  navigationHandlers.mockNavigate.mockReset();
};
