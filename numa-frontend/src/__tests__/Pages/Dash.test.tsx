/**
 * @vitest-environment jsdom
 */

// Import mock handlers and providers
import { renderWithProviders, clearAllMocks } from '../Mocks/ProviderWrapper';

// Regular imports
import { screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { Dash } from '../../Pages/Dash';
import { dashboardFixtures } from '../Fixtures/AppFixtures';

describe('Dash Component', () => {
  beforeEach(() => {
    clearAllMocks();
  });

  const renderDash = () => {
    return renderWithProviders(<Dash />, { withNumaApp: true });
  };

  it.skip('should render loading state initially', () => {
    renderDash();
    expect(screen.getByTestId('mock-preloader')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it.skip('should render apps from manifest data', async () => {
    // Mock fetch to return apps data
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardFixtures.validApps),
    });

    renderDash();

    // First verify loading state
    expect(screen.getByTestId('mock-preloader')).toBeInTheDocument();

    // Wait for loading to complete and preloader to disappear
    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    // Now verify the apps are rendered
    await waitFor(() => {
      const firstApp = dashboardFixtures.validApps.apps[0];
      expect(screen.getByTestId(`app-card-${firstApp.id}`)).toBeInTheDocument();
    });

    // Then check all apps
    dashboardFixtures.validApps.apps.forEach((app) => {
      const appCard = screen.getByTestId(`app-card-${app.id}`);
      expect(appCard).toBeInTheDocument();
      expect(within(appCard).getByTestId('app-name')).toHaveTextContent(app.appName);
      expect(within(appCard).getByTestId('app-description')).toHaveTextContent(app.appDescription);
      expect(within(appCard).getByTestId('app-status')).toHaveTextContent(app.status);
    });
  });

  it('should handle empty apps array', async () => {
    // Mock fetch to return empty apps array
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    renderDash();

    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    const appCards = screen.queryAllByTestId(/^app-card-/);
    expect(appCards).toHaveLength(0);
  });

  it('should render app cards with correct links', async () => {
    // Mock fetch to return apps data
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardFixtures.validApps),
    });

    renderDash();

    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    dashboardFixtures.validApps.apps.forEach((app) => {
      const card = screen.getByTestId(`app-card-${app.id}`);
      expect(card).toHaveAttribute('role', 'button');
    });
  });

  it.skip('should render correct layout structure', async () => {
    renderDash();

    // Check for main structural components
    expect(screen.getByTestId('mock-breadcrumbs')).toBeInTheDocument();
    expect(screen.getByTestId('mock-layout-dashboard-outer')).toBeInTheDocument();
    expect(screen.getByTestId('mock-layout-dashboard-inner')).toBeInTheDocument();
  });

  it.skip('should handle manifest parsing error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dashboardFixtures.invalidArrayApps),
    });

    renderDash();

    // First verify loading state
    expect(screen.getByTestId('mock-preloader')).toBeInTheDocument();

    // Wait for loading to complete and error to appear
    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });

    expect(screen.getByTestId('error-message')).toHaveTextContent('Failed to load apps: Data must be an array');

    // Verify fetch was called with the correct URL
    expect(global.fetch).toHaveBeenCalledWith('../manifest.json', {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Verify error was logged
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
