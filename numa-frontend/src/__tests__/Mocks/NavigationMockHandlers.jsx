export const setupNavigationMocks = () => {
  return navigationHandlers;
};

export const clearNavigationMocks = () => {
  navigationHandlers.mockNavigate.mockReset();
};

export const navigationHandlers = {
  mockNavigate: vi.fn(),
  currentRoute: '/dash',
};
