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

    // Initial load should show Apps
    expect(screen.getByText('Apps')).toBeInTheDocument();

    // Verify initial navigation stack
    const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
    expect(navigationStack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/dash',
          label: 'Apps',
        }),
      ])
    );
    expect(navigationStack).toHaveLength(1);
  });

  it('should handle clearStack prop correctly', () => {
    // Set up existing navigation stack
    const initialStack = JSON.stringify([
      { path: '/dash', label: 'Apps' },
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
          label: 'Apps',
        }),
        expect.objectContaining({
          path: '/new/path',
          label: 'New Page',
        }),
      ])
    );
    expect(actualStack).toHaveLength(2);
  });

  it('should build navigation stack correctly', async () => {
    // First render dashboard with empty initial stack
    mockSessionStorage['navigation_stack'] = JSON.stringify([]);
    const { rerender } = renderBreadcrumbs({ label: 'Apps' });

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
            label: 'Apps',
          }),
          expect.objectContaining({
            path: '/app/1',
            label: 'App 1',
          }),
          expect.objectContaining({
            path: '/app/1/settings',
            label: 'Settings',
          }),
        ])
      );
      expect(navigationStack).toHaveLength(3);
    });
  });

  it('should handle breadcrumb clicks correctly', async () => {
    // Setup initial navigation stack
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Apps' },
      { path: '/app/1', label: 'App 1' },
      { path: '/app/1/settings', label: 'Settings' },
    ]);

    // Set current route to match the last item in navigation stack
    navigationHandlers.currentRoute = '/app/1/settings';

    const { rerender } = renderBreadcrumbs({ label: 'Settings' }, '/app/1/settings');

    // Verify all breadcrumbs are rendered
    expect(screen.getByText('Apps')).toBeInTheDocument();
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
      { path: '/dash', label: 'Apps' },
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
      { path: '/dash', label: 'Apps' },
      { path: '/app/1', label: 'App 1' },
    ]);

    renderBreadcrumbs({}, '/app/1');

    // Check for separator
    expect(screen.getByText('>')).toBeInTheDocument();
  });

  it('should not render current page as a link', () => {
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Apps' },
      { path: '/app/1', label: 'App 1' },
    ]);

    renderBreadcrumbs({}, '/app/1');

    // Apps should be a link
    expect(screen.getByText('Apps').tagName).toBe('A');
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
        label: 'Apps',
      },
    ]);
  });

  it('should handle navigation back to dashboard', () => {
    // Setup initial navigation stack
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Apps' },
      { path: '/app/1', label: 'App 1' },
    ]);

    renderBreadcrumbs({}, '/dash');

    // Check that only dashboard remains
    const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
    expect(navigationStack).toHaveLength(1);
    expect(navigationStack[0].label).toBe('Apps');
  });

  it('should handle clicks when clicked index exceeds stack length', async () => {
    // Setup initial navigation stack with only Apps
    mockSessionStorage['navigation_stack'] = JSON.stringify([{ path: '/dash', label: 'Apps' }]);

    // First render with Apps
    const { rerender } = renderBreadcrumbs({}, '/dash');

    // Add App 1 to UI and stack
    navigationHandlers.currentRoute = '/app/1';
    rerender(<Breadcrumbs label="App 1" />);

    // Manually modify the stack to create the edge case
    // Now the UI will show Apps > App 1, but stack only has Apps
    mockSessionStorage['navigation_stack'] = JSON.stringify([{ path: '/dash', label: 'Apps' }]);

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

  it('should prevent empty labels from causing separator-only breadcrumbs', () => {
    // Setup navigation stack with empty/undefined labels that would cause >>>>> issue
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Apps' },
      { path: '/app/1', label: '' }, // Empty label
      { path: '/app/1/settings', label: undefined }, // Undefined label
      { path: '/app/1/settings/advanced', label: null }, // Null label
    ]);

    renderBreadcrumbs({}, '/app/1/settings/advanced');

    // Verify that empty labels are replaced with fallback text
    const appLabels = screen.getAllByText('Apps');
    expect(appLabels.length).toBeGreaterThan(0);

    // Check that we have multiple fallback elements (proving fallbacks work)
    const fallbackLabels = screen.getAllByText('Apps');
    expect(fallbackLabels.length).toBeGreaterThan(1);

    // Check that we don't have just separators - each breadcrumb should have text
    const breadcrumbItems = screen.getAllByRole('listitem');
    expect(breadcrumbItems).toHaveLength(4);

    // Verify no empty breadcrumbs exist
    breadcrumbItems.forEach((item) => {
      expect(item.textContent.trim()).not.toBe('');
      expect(item.textContent.trim()).not.toBe('>');
    });

    // Verify the navigation stack has fallback labels
    const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
    expect(navigationStack).toEqual([
      { path: '/dash', label: 'Apps' },
      { path: '/app/1', label: '' }, // Original empty label preserved in storage
      { path: '/app/1/settings', label: undefined }, // Original undefined label preserved in storage
      { path: '/app/1/settings/advanced', label: null }, // Original null label preserved in storage
    ]);
  });

  it('should handle undefined label prop gracefully', () => {
    // Render with undefined label prop
    renderBreadcrumbs({ label: undefined }, '/some/path');

    // Should use fallback label for the current page
    const appLabels = screen.getAllByText('Apps');
    expect(appLabels.length).toBeGreaterThan(0);

    // Verify navigation stack has fallback label
    const navigationStack = JSON.parse(mockSessionStorage['navigation_stack'] || '[]');
    expect(navigationStack).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/some/path',
          label: 'Apps',
        }),
      ])
    );
  });
});
