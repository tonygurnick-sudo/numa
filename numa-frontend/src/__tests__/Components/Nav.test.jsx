/**
 * @vitest-environment jsdom
 */

// Import mocks first
import {
  setupNavigationMocks,
  clearNavigationMocks,
  MockMemoryRouter,
} from '../Mocks/NavigationMock';
import {
  setupAuthMocks,
  clearAuthMocks,
  MockAuthProvider,
} from '../Mocks/AuthMock';
import { renderWithProviders } from '../Mocks/ProviderWrapper';

// Regular imports
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { Nav } from '../../Components/Nav';

describe('Nav Component', () => {
  const { mockNavigate } = setupNavigationMocks();
  const { logout: mockLogout } = setupAuthMocks();

  beforeEach(() => {
    vi.clearAllMocks();
    clearNavigationMocks();
    clearAuthMocks();

    // Mock window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
    });
  });

  it('renders without crashing', () => {
    renderWithProviders(<Nav />);

    expect(screen.getByText('Dash')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Files')).toBeInTheDocument();
    expect(screen.getByText('Log out')).toBeInTheDocument();
    expect(screen.getByText('v0.1')).toBeInTheDocument();
  });

  it('should render mobile navigation when screen width <= 768px', () => {
    // Set mobile width
    window.innerWidth = 768;

    // Trigger resize event
    fireEvent(window, new Event('resize'));

    renderWithProviders(<Nav />);

    // Check for mobile menu button using data-testid
    const dropdownButton = screen.getByTestId('mobile-menu-button');
    expect(dropdownButton).toHaveAttribute('id', 'nav-dropdown');
    expect(dropdownButton).toHaveClass('dropdown-toggle');
  });

  it('should handle mobile menu interactions', () => {
    // Set mobile width
    window.innerWidth = 768;
    fireEvent(window, new Event('resize'));

    renderWithProviders(<Nav />);

    // Open mobile menu using data-testid
    const menuButton = screen.getByTestId('mobile-menu-button');
    fireEvent.click(menuButton);

    // Check mobile menu items
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.getByText('Upload Files')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('should handle navigation clicks correctly', () => {
    renderWithProviders(<Nav />);

    // Test dashboard navigation
    fireEvent.click(screen.getByText('Dash'));
    expect(mockNavigate).toHaveBeenCalledWith('/dash');

    // Test chat navigation
    fireEvent.click(screen.getByText('Chat'));
    expect(mockNavigate).toHaveBeenCalledWith('/chat');

    // Test files navigation - updated to match actual path
    fireEvent.click(screen.getByText('Files'));
    expect(mockNavigate).toHaveBeenCalledWith('/upload');

    // Test logout navigation
    fireEvent.click(screen.getByText('Log out'));
    expect(mockLogout).toHaveBeenCalled();
  });

  describe('Mobile Navigation', () => {
    beforeEach(() => {
      // Set mobile width
      window.innerWidth = 768;
      fireEvent(window, new Event('resize'));
    });

    it('should handle mobile menu navigation clicks correctly', () => {
      renderWithProviders(<Nav />);

      // Open mobile menu
      const menuButton = screen.getByTestId('mobile-menu-button');
      fireEvent.click(menuButton);

      // Test dashboard navigation
      fireEvent.click(screen.getByText('Dashboard'));
      expect(mockNavigate).toHaveBeenCalledWith('/dash');

      // Test chat navigation
      fireEvent.click(screen.getByText('Chat'));
      expect(mockNavigate).toHaveBeenCalledWith('/chat');

      // Test files navigation
      fireEvent.click(screen.getByText('Upload Files'));
      expect(mockNavigate).toHaveBeenCalledWith('/upload');

      // Test settings navigation
      fireEvent.click(screen.getByText('Settings'));
      expect(mockNavigate).toHaveBeenCalledWith('/my-account');

      // Test logout
      const logoutButton = screen.getByRole('button', { name: 'Log out' });
      fireEvent.click(logoutButton);
      expect(mockLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });

    it('should render mobile navigation elements correctly', () => {
      renderWithProviders(<Nav />);

      // Check for mobile-specific elements
      const menuButton = screen.getByTestId('mobile-menu-button');
      expect(menuButton).toBeInTheDocument();
      expect(menuButton).toHaveClass('dropdown-toggle');

      // Open menu
      fireEvent.click(menuButton);

      // Check for menu items with icons
      const menuItems = screen.getAllByRole('button');
      expect(menuItems.length).toBeGreaterThan(0);

      // Check for specific icons
      expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Chat')).toBeInTheDocument();
      expect(screen.getByText('Upload Files')).toBeInTheDocument();
      expect(screen.getByText('Settings')).toBeInTheDocument();
    });
  });

  it('should handle window resize from desktop to mobile', () => {
    // Start with desktop width
    window.innerWidth = 1024;
    renderWithProviders(<Nav />);

    // Initially should show desktop nav
    expect(screen.getByText('Dash')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-menu-button')).not.toBeInTheDocument();

    // Simulate resize to mobile width
    window.innerWidth = 768;
    fireEvent(window, new Event('resize'));

    // Should now show mobile nav
    expect(screen.queryByText('Dash')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
  });

  it('should handle window resize from mobile to desktop', () => {
    // Start with mobile width
    window.innerWidth = 768;
    renderWithProviders(<Nav />);

    // Initially should show mobile nav
    expect(screen.queryByText('Dash')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();

    // Simulate resize to desktop width
    window.innerWidth = 1024;
    fireEvent(window, new Event('resize'));

    // Should now show desktop nav
    expect(screen.getByText('Dash')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-menu-button')).not.toBeInTheDocument();
  });
});
