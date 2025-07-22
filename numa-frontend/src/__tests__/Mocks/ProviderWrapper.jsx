import { render } from '@testing-library/react';
import { clearNavigationMocks } from './NavigationMockHandlers';
import { MockMemoryRouter } from './NavigationMock';
import { clearAuthMocks } from './AuthMockHandlers';
import { MockAuthProvider } from './AuthMock';
import { NumaAppProvider } from '../../Providers/NumaAppProvider';
import { NumaRequestProvider } from '../../Providers/RequestProvider';
import { vi } from 'vitest';
import { NicetyProvider } from '../../Providers/NicetyProvider';

export const clearAllMocks = () => {
  vi.clearAllMocks();
  clearNavigationMocks();
  clearAuthMocks();
};

export const renderWithProviders = (ui, options = {}) => {
  const Wrapper = ({ children }) => (
    <NicetyProvider>
      <NumaRequestProvider>
        <MockAuthProvider>
          <NumaAppProvider>
            <MockMemoryRouter>{children}</MockMemoryRouter>
          </NumaAppProvider>
        </MockAuthProvider>
      </NumaRequestProvider>
    </NicetyProvider>
  );

  return render(ui, { wrapper: Wrapper, ...options });
};
