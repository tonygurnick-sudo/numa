/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { Dash } from '../Dash';
import { NumaAppProvider } from '../../Providers/NumaAppProvider';

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

// Mock example app data
const mockApps = [
  {
    id: '1',
    appName: 'Test App 1',
    appVersion: '1.0.0',
    appDescription: 'Test Description 1',
    status: 'ACTIVE',
  },
  {
    id: '2',
    appName: 'Test App 2',
    appVersion: '2.0.0',
    appDescription: 'Test Description 2',
    status: 'COMING_SOON',
  },
];

describe('Dash Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
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

  it('should render apps after successful data fetch', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockApps),
    });

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    // Wait for apps to load
    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    // Check if apps are rendered
    mockApps.forEach((app) => {
      expect(screen.getByTestId(`app-card-${app.id}`)).toBeInTheDocument();
      expect(screen.getByText(app.appName)).toBeInTheDocument();
      expect(screen.getByText(app.appDescription)).toBeInTheDocument();
      expect(screen.getByText(`v${app.appVersion}`)).toBeInTheDocument();
      expect(screen.getByText(app.status)).toBeInTheDocument();
    });
  });

  it('should handle fetch error correctly', async () => {
    const errorMessage = 'Failed to fetch apps';
    global.fetch.mockRejectedValueOnce(new Error(errorMessage));

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    // Wait for error message to appear
    await waitFor(() => {
      expect(screen.getByTestId('error-message')).toBeInTheDocument();
    });

    expect(screen.getByTestId('error-message')).toHaveTextContent(errorMessage);
  });

  it('should persist apps data to sessionStorage', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockApps),
    });

    // Mock sessionStorage
    const mockSetItem = vi.fn();
    Storage.prototype.setItem = mockSetItem;

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    // Wait for apps to load
    await waitFor(() => {
      expect(mockSetItem).toHaveBeenCalledWith(
        'appsData',
        JSON.stringify(mockApps),
      );
    });
  });

  it('should render correct layout structure', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockApps),
    });

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

  it('should render app cards with correct links', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockApps),
    });

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    // Wait for apps to load
    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    // Check if app cards have correct links
    mockApps.forEach((app) => {
      const card = screen.getByTestId(`app-card-${app.id}`);
      const link = card.querySelector('a');
      expect(link).toHaveAttribute('href', `/app/${app.id}`);
    });
  });

  it('should handle empty apps array', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    render(
      <NumaAppProvider>
        <Dash />
      </NumaAppProvider>,
    );

    // Wait for loading to finish
    await waitFor(() => {
      expect(screen.queryByTestId('mock-preloader')).not.toBeInTheDocument();
    });

    // Verify no app cards are rendered
    expect(screen.queryByTestId(/app-card-/)).not.toBeInTheDocument();
  });
});
