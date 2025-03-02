import { render } from '@testing-library/react';
import { MockMemoryRouter, clearNavigationMocks } from './NavigationMock';
import { MockAuthProvider, clearAuthMocks } from './AuthMock';
import { NumaAppProvider } from '../../Providers/NumaAppProvider';
import { NumaRequestProvider } from '../../Providers/RequestProvider';
import { vi } from 'vitest';

export const clearAllMocks = () => {
  vi.clearAllMocks();
  clearNavigationMocks();
  clearAuthMocks();
};

export const renderWithProviders = (ui, options = {}) => {
  const Wrapper = ({ children }) => (
    <NumaRequestProvider>
      <MockAuthProvider>
        <NumaAppProvider>
          <MockMemoryRouter>{children}</MockMemoryRouter>
        </NumaAppProvider>
      </MockAuthProvider>
    </NumaRequestProvider>
  );

  return render(ui, { wrapper: Wrapper, ...options });
};
