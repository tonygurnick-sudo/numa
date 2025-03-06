/**
 * @vitest-environment jsdom
 */
import { navigationHandlers } from '../Mocks/NavigationMockHandlers';
import { renderWithProviders, clearAllMocks } from '../Mocks/ProviderWrapper';

import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

import { Breadcrumbs } from '../../Components/Breadcrumbs';

describe('Breadcrumbs Component', () => {
  let mockSessionStorage = {};

  beforeEach(() => {
    clearAllMocks();
    mockSessionStorage = {};

    // Mock sessionStorage
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => mockSessionStorage[key] || null),
        setItem: vi.fn((key, value) => {
          mockSessionStorage[key] = String(value);
        }),
        removeItem: vi.fn((key) => {
          delete mockSessionStorage[key];
        }),
      },
      writable: true,
    });
  });

  const renderBreadcrumbs = (props = {}, route = '/dash') => {
    navigationHandlers.currentRoute = route;
    return renderWithProviders(<Breadcrumbs {...props} />);
  };

  it('should render dashboard breadcrumb on initial load', () => {
    renderBreadcrumbs();

    // Initial load should show Dashboard
    expect(screen.getByText('Dashboard')).toBeInTheDocument();

    // Verify initial navigation stack
    const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
    expect(navigationStack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/dash',
          label: 'Dashboard',
        }),
      ]),
    );
    expect(navigationStack).toHaveLength(1);
  });

  it('should handle clearStack prop correctly', () => {
    // Set up existing navigation stack
    const initialStack = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
      { path: '/some/other/path', label: 'Other Page' },
    ]);
    mockSessionStorage['navigation_stack'] = initialStack;

    renderBreadcrumbs({ clearStack: true, label: 'New Page' }, '/new/path');

    // Parse the actual stack and compare objects instead of strings
    const actualStack = JSON.parse(mockSessionStorage['navigation_stack']);
    expect(actualStack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/dash',
          label: 'Dashboard',
        }),
        expect.objectContaining({
          path: '/new/path',
          label: 'New Page',
        }),
      ]),
    );
    expect(actualStack).toHaveLength(2);
  });

  it('should build navigation stack correctly', async () => {
    // First render dashboard with empty initial stack
    mockSessionStorage['navigation_stack'] = JSON.stringify([]);
    const { rerender } = renderBreadcrumbs({ label: 'Dashboard' });

    // Navigate to a new page
    navigationHandlers.currentRoute = '/app/1';
    rerender(<Breadcrumbs label="App 1" />);

    // Navigate to another page
    navigationHandlers.currentRoute = '/app/1/settings';
    rerender(<Breadcrumbs label="Settings" />);

    await waitFor(() => {
      const navigationStack = JSON.parse(mockSessionStorage['navigation_stack']);
      expect(navigationStack).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: '/dash',
            label: 'Dashboard',
          }),
          expect.objectContaining({
            path: '/app/1',
            label: 'App 1',
          }),
          expect.objectContaining({
            path: '/app/1/settings',
            label: 'Settings',
          }),
        ]),
      );
      expect(navigationStack).toHaveLength(3);
    });
  });

  it('should handle breadcrumb clicks correctly', async () => {
    // Setup initial navigation stack
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
      { path: '/app/1', label: 'App 1' },
      { path: '/app/1/settings', label: 'Settings' },
    ]);

    // Set current route to match the last item in navigation stack
    navigationHandlers.currentRoute = '/app/1/settings';

    const { rerender } = renderBreadcrumbs({ label: 'Settings' }, '/app/1/settings');

    // Verify all breadcrumbs are rendered
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('App 1')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();

    // Click the "App 1" breadcrumb
    const appLink = screen.getByText('App 1');
    fireEvent.click(appLink);

    // Check if navigation occurred
    expect(navigationHandlers.mockNavigate).toHaveBeenCalledWith('/app/1');

    // Update current route to match navigation
    navigationHandlers.currentRoute = '/app/1';
    rerender(<Breadcrumbs label="App 1" />);

    // Check if navigation stack was updated
    await waitFor(() => {
      const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
      expect(navigationStack).toHaveLength(2);
      expect(navigationStack[1].label).toBe('App 1');
    });
  });

  it('should handle duplicate paths in navigation stack', () => {
    // Setup initial navigation stack with duplicate paths
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
      { path: '/app/1', label: 'App 1' },
      { path: '/app/1', label: 'App 1' }, // Duplicate
    ]);

    renderBreadcrumbs({}, '/app/1');

    // Check that duplicates are removed
    const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
    expect(navigationStack).toHaveLength(2);
  });

  it('should render separator between breadcrumbs correctly', () => {
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
      { path: '/app/1', label: 'App 1' },
    ]);

    renderBreadcrumbs({}, '/app/1');

    // Check for separator
    expect(screen.getByText('>')).toBeInTheDocument();
  });

  it('should not render current page as a link', () => {
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
      { path: '/app/1', label: 'App 1' },
    ]);

    renderBreadcrumbs({}, '/app/1');

    // Dashboard should be a link
    expect(screen.getByText('Dashboard').tagName).toBe('A');
    // Current page (App 1) should not be a link
    const app1Text = screen.getByText('App 1');
    expect(app1Text.tagName).not.toBe('A');
  });

  it('should handle empty label prop', () => {
    // Set up initial empty navigation stack
    mockSessionStorage['navigation_stack'] = JSON.stringify([]);

    // Render with route '/dash' since that's the dashboard route
    renderBreadcrumbs({}, '/dash');

    const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
    expect(navigationStack).toEqual([
      {
        path: '/dash',
        label: 'Dashboard',
      },
    ]);
  });

  it('should handle navigation back to dashboard', () => {
    // Setup initial navigation stack
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
      { path: '/app/1', label: 'App 1' },
    ]);

    renderBreadcrumbs({}, '/dash');

    // Check that only dashboard remains
    const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
    expect(navigationStack).toHaveLength(1);
    expect(navigationStack[0].label).toBe('Dashboard');
  });

  it('should handle clicks when clicked index exceeds stack length', async () => {
    // Setup initial navigation stack with only Dashboard
    mockSessionStorage['navigation_stack'] = JSON.stringify([{ path: '/dash', label: 'Dashboard' }]);

    // First render with Dashboard
    const { rerender } = renderBreadcrumbs({}, '/dash');

    // Add App 1 to UI and stack
    navigationHandlers.currentRoute = '/app/1';
    rerender(<Breadcrumbs label="App 1" />);

    // Manually modify the stack to create the edge case
    // Now the UI will show Dashboard > App 1, but stack only has Dashboard
    mockSessionStorage['navigation_stack'] = JSON.stringify([{ path: '/dash', label: 'Dashboard' }]);

    // Click App 1 - this should trigger the condition since clickedIndex will be 1
    // but stack.length is 1, so 1 >= 1 is true
    const appLink = screen.getByText('App 1');
    fireEvent.click(appLink);

    // Verify the stack adjustment
    await waitFor(() => {
      const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
      expect(navigationStack).toHaveLength(1);
      expect(navigationStack[0].path).toBe('/dash');
    });
  });
});
