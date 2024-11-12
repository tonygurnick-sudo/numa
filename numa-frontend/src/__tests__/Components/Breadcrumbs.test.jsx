/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { Breadcrumbs } from '../../Components/Breadcrumbs';
import { MemoryRouter, useNavigate, useLocation } from 'react-router-dom';

// Mock react-router-dom hooks
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: vi.fn(),
    useLocation: vi.fn(),
  };
});

describe('Breadcrumbs Component', () => {
  const mockNavigate = vi.fn();
  let mockSessionStorage = {};

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStorage = {};

    // Mock sessionStorage with proper JSON handling
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => {
          // Return null if key doesn't exist (matches real sessionStorage behavior)
          return mockSessionStorage[key] || null;
        }),
        setItem: vi.fn((key, value) => {
          // Ensure value is a string (matches real sessionStorage behavior)
          mockSessionStorage[key] = String(value);
        }),
        removeItem: vi.fn((key) => {
          delete mockSessionStorage[key];
        }),
      },
      writable: true,
    });

    // Setup router mocks
    useNavigate.mockReturnValue(mockNavigate);
    useLocation.mockReturnValue({ pathname: '/dash' });
  });

  const renderWithRouter = (ui, { route = '/dash' } = {}) => {
    useLocation.mockReturnValue({ pathname: route });
    return render(<MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>);
  };

  it('should render dashboard breadcrumb on initial load', () => {
    renderWithRouter(<Breadcrumbs />);

    // Initial load should show Dashboard
    expect(screen.getByText('Dashboard')).toBeInTheDocument();

    // Verify initial navigation stack
    const navigationStack = JSON.parse(
      mockSessionStorage['navigation_stack'] || '[]',
    );
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

    renderWithRouter(<Breadcrumbs clearStack={true} label="New Page" />, {
      route: '/new/path',
    });

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
    const { rerender } = renderWithRouter(<Breadcrumbs label="Dashboard" />);

    // Navigate to a new page
    useLocation.mockReturnValue({ pathname: '/app/1' });
    rerender(
      <MemoryRouter>
        <Breadcrumbs label="App 1" />
      </MemoryRouter>,
    );

    // Navigate to another page
    useLocation.mockReturnValue({ pathname: '/app/1/settings' });
    rerender(
      <MemoryRouter>
        <Breadcrumbs label="Settings" />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const navigationStack = JSON.parse(
        mockSessionStorage['navigation_stack'],
      );
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

    renderWithRouter(<Breadcrumbs />, { route: '/app/1/settings' });

    // Click the "App 1" breadcrumb
    const appLink = screen.getByText('App 1');
    fireEvent.click(appLink);

    // Check if navigation occurred
    expect(mockNavigate).toHaveBeenCalledWith('/app/1');

    // Check if navigation stack was updated
    await waitFor(() => {
      const navigationStack = JSON.parse(
        mockSessionStorage['navigation_stack'] || '[]',
      );
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

    renderWithRouter(<Breadcrumbs />, { route: '/app/1' });

    // Check that duplicates are removed
    const navigationStack = JSON.parse(
      mockSessionStorage['navigation_stack'] || '[]',
    );
    expect(navigationStack).toHaveLength(2);
  });

  it('should render separator between breadcrumbs correctly', () => {
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
      { path: '/app/1', label: 'App 1' },
    ]);

    renderWithRouter(<Breadcrumbs />, { route: '/app/1' });

    // Check for separator
    expect(screen.getByText('>')).toBeInTheDocument();
  });

  it('should not render current page as a link', () => {
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
      { path: '/app/1', label: 'App 1' },
    ]);

    renderWithRouter(<Breadcrumbs />, { route: '/app/1' });

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
    renderWithRouter(<Breadcrumbs />, { route: '/dash' });

    const navigationStack = JSON.parse(
      mockSessionStorage['navigation_stack'] || '[]',
    );
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

    renderWithRouter(<Breadcrumbs />, { route: '/dash' });

    // Check that only dashboard remains
    const navigationStack = JSON.parse(
      mockSessionStorage['navigation_stack'] || '[]',
    );
    expect(navigationStack).toHaveLength(1);
    expect(navigationStack[0].label).toBe('Dashboard');
  });

  it('should handle clicks when clicked index exceeds stack length', async () => {
    // Setup initial navigation stack with only Dashboard
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
    ]);

    // First render with Dashboard
    const { rerender } = renderWithRouter(<Breadcrumbs />, { route: '/dash' });

    // Add App 1 to UI and stack
    useLocation.mockReturnValue({ pathname: '/app/1' });
    rerender(
      <MemoryRouter>
        <Breadcrumbs label="App 1" />
      </MemoryRouter>,
    );

    // Manually modify the stack to create the edge case
    // Now the UI will show Dashboard > App 1, but stack only has Dashboard
    mockSessionStorage['navigation_stack'] = JSON.stringify([
      { path: '/dash', label: 'Dashboard' },
    ]);

    // Click App 1 - this should trigger the condition since clickedIndex will be 1
    // but stack.length is 1, so 1 >= 1 is true
    const appLink = screen.getByText('App 1');
    fireEvent.click(appLink);

    // Verify the stack adjustment
    await waitFor(() => {
      const navigationStack = JSON.parse(
        mockSessionStorage['navigation_stack'] || '[]',
      );
      expect(navigationStack).toHaveLength(1);
      expect(navigationStack[0].path).toBe('/dash');
    });
  });
});
