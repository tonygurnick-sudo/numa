import { vi } from 'vitest';
import React from 'react';
import { navigationHandlers } from './NavigationMockHandlers';

// Create Router context
const RouterContext = React.createContext(null);

// Create a mock MemoryRouter component that provides navigation context
export const MockMemoryRouter = ({ children }) => (
  <RouterContext.Provider value={{ navigator: { push: navigationHandlers.mockNavigate } }}>
    <div data-testid="mock-memory-router">{children}</div>
  </RouterContext.Provider>
);

// Mock the module BEFORE any imports
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigationHandlers.mockNavigate,
    MemoryRouter: ({ children }) => children,
    useLocation: () => ({ pathname: navigationHandlers.currentRoute }),
    useParams: () => ({}),
  };
});
