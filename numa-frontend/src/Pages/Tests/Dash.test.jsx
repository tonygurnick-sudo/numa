/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render } from '@testing-library/react';
import { waitFor, screen } from '@testing-library/react/pure';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { Dash } from '../Dash';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../../Providers/AuthProvider';

// Mock example data
const mockAppsData = {
  apps: [
    {
      id: '1',
      appName: 'Test App',
      appVersion: '1.0',
      appDescription: 'Test Description',
      status: 'active',
    },
  ],
};

// Wrap component with required providers
const DashWithProviders = () => (
  <BrowserRouter>
    <AuthProvider>
      <Dash />
    </AuthProvider>
  </BrowserRouter>
);

describe('Dash Component', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root');

    vi.clearAllMocks();
    global.fetch = vi.fn();

    // Mock sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn(() => JSON.stringify([])),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });
  });

  describe('Initial Rendering', () => {
    it('should render loading state initially', () => {
      render(<DashWithProviders />, { container });
      expect(screen.getByTestId('preloader')).toBeInTheDocument();
    });

    it('should render dashboard title and create button', () => {
      render(<DashWithProviders />, { container });
      expect(
        screen.getByRole('heading', { name: 'Dashboard' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /create/i }),
      ).toBeInTheDocument();
    });
  });

  describe('Data Fetching', () => {
    it('should render apps data after successful fetch', async () => {
      // Mock successful fetch
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAppsData),
      });

      render(<DashWithProviders />, { container });

      // Wait for app data to load
      await waitFor(() => {
        expect(screen.getByText('Test App')).toBeInTheDocument();
        expect(screen.getByText('Test Description')).toBeInTheDocument();
        expect(screen.getByText('v1.0')).toBeInTheDocument();
      });

      // Verify sessionStorage was updated
      expect(window.sessionStorage.setItem).toHaveBeenCalledWith(
        'appsData',
        JSON.stringify(mockAppsData),
      );
    });

    it('should handle fetch failure gracefully', async () => {
      // Mock failed fetch with error message
      global.fetch.mockRejectedValueOnce(new Error('Failed to fetch'));

      render(<DashWithProviders />, { container });

      // Wait for error message to appear
      await waitFor(() => {
        // Look for error message text with a case-insensitive regex
        expect(screen.getByText(/failed to fetch/i)).toBeInTheDocument();
      });
    });

    it('should handle empty apps data', async () => {
      // Mock successful fetch with empty apps array
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ apps: [] }),
      });

      render(<DashWithProviders />, { container });

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByTestId('preloader')).not.toBeInTheDocument();
      });

      // Verify no app cards are rendered
      expect(screen.queryByText('Test App')).not.toBeInTheDocument();
    });
  });

  describe('UI Elements', () => {
    it('should render app cards with correct information', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAppsData),
      });

      render(<DashWithProviders />, { container });

      await waitFor(() => {
        // Check card structure
        const card = screen.getByText('Test App').closest('.card-apps');
        expect(card).toBeInTheDocument();

        // Check version label
        expect(card.querySelector('.card-header label')).toHaveTextContent(
          'v1.0',
        );

        // Check description
        expect(card.querySelector('.card-body')).toHaveTextContent(
          'Test Description',
        );

        // Check status badge
        expect(card.querySelector('.badge-status')).toHaveTextContent('active');
      });
    });

    it('should render breadcrumbs navigation', () => {
      render(<DashWithProviders />, { container });
      // Note: Actual breadcrumb testing might need to be adjusted based on your Breadcrumbs component implementation
      expect(screen.getByRole('navigation')).toBeInTheDocument();
    });
  });

  describe('Session Storage', () => {
    it('should persist apps data to session storage', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockAppsData),
      });

      render(<DashWithProviders />, { container });

      await waitFor(() => {
        expect(window.sessionStorage.setItem).toHaveBeenCalledWith(
          'appsData',
          JSON.stringify(mockAppsData),
        );
      });
    });
  });
});
