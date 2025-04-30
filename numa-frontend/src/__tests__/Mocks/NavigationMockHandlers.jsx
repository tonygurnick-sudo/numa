import { vi } from 'vitest';

export const setupNavigationMocks = (initialLocation) => {
  navigationHandlers.currentLocation = initialLocation || {
    pathname: navigationHandlers.currentRoute,
    search: '',
    hash: '',
  };
  return navigationHandlers;
};

export const clearNavigationMocks = () => {
  navigationHandlers.mockNavigate.mockReset();
  navigationHandlers.currentLocation = null;
};

export const navigationHandlers = {
  mockNavigate: vi.fn(),
  currentRoute: '/dash',
  currentLocation: null,
};
