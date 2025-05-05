import { vi } from 'vitest';

export const setupNavigationMocks = (initialLocation) => {
  // If initialLocation is not provided, use the current route
  navigationHandlers.currentLocation = initialLocation || {
    pathname: navigationHandlers.currentRoute,
    search: initialLocation?.search || '',
    hash: initialLocation?.hash || '',
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
