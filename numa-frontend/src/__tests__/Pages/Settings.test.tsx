/**
 * @vitest-environment jsdom
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';

import SettingsPage from '../../Pages/Settings';

const mockUseAuth = vi.fn();
const mockNumaGet = vi.fn();
const mockNumaPut = vi.fn();

vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('../../Providers/NumaRequestContext', () => ({
  useNumaRequest: () => ({
    numaGet: mockNumaGet,
    numaPut: mockNumaPut,
  }),
}));

vi.mock('../../Services/AdminIntegrationsService', () => ({
  AdminIntegrationsService: {
    getCached: vi.fn().mockReturnValue(null),
    listWithNuma: vi.fn().mockResolvedValue({}),
    updateWithNuma: vi.fn(),
  },
}));

vi.mock('../../Services/PipedreamProxyService', () => ({
  PipedreamProxyService: {
    deriveExternalUserId: vi.fn(),
    listMcpTools: vi.fn().mockResolvedValue({ tools: [] }),
  },
}));

vi.mock('../../Components/Nav', () => ({
  Nav: () => <nav data-testid="nav" />,
}));

vi.mock('../../Components/Breadcrumbs', () => ({
  Breadcrumbs: ({ label }: { label: string }) => <div data-testid="breadcrumbs">{label}</div>,
}));

vi.mock('../../Components/Branding/BrandingAdminPanel', () => ({
  __esModule: true,
  default: () => <div data-testid="branding-panel" />,
}));

vi.mock('../../Pages/UserManagement', () => ({
  __esModule: true,
  default: () => <div data-testid="user-management" />,
}));

vi.mock('../../Pages/UserProfile', () => ({
  __esModule: true,
  default: () => <div data-testid="user-profile" />,
}));

vi.mock('../../Services/manifestService', () => ({
  manifestService: {
    fetchAppsFromManifest: vi.fn().mockResolvedValue([]),
  },
}));

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    sessionStorage.setItem('PIPEDREAM_INTEGRATIONS', 'false');
    mockNumaGet.mockResolvedValue([]);
    mockNumaPut.mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: {
        groups: ['admin'],
        tokens: { idToken: 'token' },
        decoded_tokens: { idToken: { 'cognito:groups': ['admin'], sub: 'user' } },
      },
      lambdaClient: null,
    });
  });

  it('shows the Branding tab for admin users when branding is enabled', async () => {
    sessionStorage.setItem('BRANDING_PROVIDER_ENABLED', 'true');
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    expect(await screen.findByTestId('branding-panel')).toBeInTheDocument();
  });

  it('hides the Branding tab when branding feature is disabled', async () => {
    sessionStorage.setItem('BRANDING_PROVIDER_ENABLED', 'false');
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.queryByTestId('branding-panel')).not.toBeInTheDocument();
    });
  });
});
