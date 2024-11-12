/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { Dash } from '../../Pages/Dash';
import { NumaAppProvider } from '../../Providers/NumaAppProvider';
import { dashboardFixtures } from '../Fixtures/PageFixtures';

// Mock the components used in Dash
vi.mock('../../Components/Breadcrumbs', () => ({
  Breadcrumbs: () => <div data-testid="mock-breadcrumbs">Breadcrumbs</div>,
}));

vi.mock('../../Components/Nav', () => ({
  Nav: () => <div data-testid="mock-nav">Nav</div>,
}));

vi.mock('../../Components/Preloader', () => ({
  Preloader: ({ smallscreen }) => (
    <div data-testid={`mock-preloader${smallscreen ? '-small' : ''}`}>
      Loading...
    </div>
  ),
}));

vi.mock('../../Layouts/LayoutDashboard', () => ({
  LayoutDashboard: ({ children }) => (
    <div data-testid="mock-layout-dashboard">{children}</div>
  ),
}));

describe('Dash Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    vi.resetModules();
  });

  it('should render loading state initially', () => {
    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    expect(screen.getByTestId('mock-preloader')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('should render apps from manifest data', async () => {
    sessionStorage.setItem(
      'appsData',
      JSON.stringify(dashboardFixtures.validApps.apps),
    );

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    dashboardFixtures.validApps.apps.forEach((app) => {
      const appCard = screen.getByTestId(`app-card-${app.id}`);
      expect(appCard).toBeInTheDocument();
      expect(
        appCard.querySelector('[data-testid="app-name"]'),
      ).toHaveTextContent(app.appName);
      expect(
        appCard.querySelector('[data-testid="app-description"]'),
      ).toHaveTextContent(app.appDescription);
      expect(
        appCard.querySelector('[data-testid="app-status"]'),
      ).toHaveTextContent(app.status);
    });
  });

  it('should load data from sessionStorage if available', async () => {
    const cachedApps = [dashboardFixtures.validApps.apps[0]]; // Use first app from fixtures

    sessionStorage.setItem('appsData', JSON.stringify(cachedApps));

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    const allAppCards = screen.getAllByTestId(/^app-card-/);
    expect(allAppCards).toHaveLength(1);

    const cachedApp = cachedApps[0];
    const cachedAppCard = screen.getByTestId(`app-card-${cachedApp.id}`);
    expect(within(cachedAppCard).getByTestId('app-name')).toHaveTextContent(
      cachedApp.appName,
    );
    expect(
      within(cachedAppCard).getByTestId('app-description'),
    ).toHaveTextContent(cachedApp.appDescription);
    expect(within(cachedAppCard).getByTestId('app-status')).toHaveTextContent(
      cachedApp.status,
    );
  });

  it('should handle empty apps array', async () => {
    sessionStorage.setItem('appsData', JSON.stringify([]));

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    const appCards = screen.queryAllByTestId(/^app-card-/);
    expect(appCards).toHaveLength(0);
  });

  it('should render app cards with correct links', async () => {
    sessionStorage.setItem(
      'appsData',
      JSON.stringify(dashboardFixtures.validApps.apps),
    );

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    dashboardFixtures.validApps.apps.forEach((app) => {
      const card = screen.getByTestId(`app-card-${app.id}`);
      const link = card.querySelector('a');
      expect(link).toHaveAttribute('href', `/app/${app.id}`);
    });
  });

  it('should render correct layout structure', async () => {
    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    // Check for main structural components
    expect(screen.getByTestId('mock-breadcrumbs')).toBeInTheDocument();
    expect(screen.getByTestId('mock-layout-dashboard')).toBeInTheDocument();
    expect(screen.getByTestId('mock-nav')).toBeInTheDocument();
  });

  it('should handle manifest parsing error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Clear any existing sessionStorage
    sessionStorage.clear();

    // Mock fetch to return the invalid apps structure
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardFixtures.invalidArrayApps), // Use the invalid fixture directly
    });

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    // Verify error state
    expect(screen.getByTestId('error-message')).toBeInTheDocument();
    expect(screen.getByTestId('error-message')).toHaveTextContent(
      'Failed to load apps: Data must be an array',
    );

    // Verify fetch was called with the correct URL
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/manifest.json'),
      expect.any(Object),
    );

    // Verify error was logged
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
