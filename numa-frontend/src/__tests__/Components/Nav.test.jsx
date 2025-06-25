/**
 * @vitest-environment jsdom
 */

// Import mocks first
import { setupNavigationMocks, clearNavigationMocks } from '../Mocks/NavigationMockHandlers';
import { setupAuthMocks, clearAuthMocks, setMockUser } from '../Mocks/AuthMockHandlers';
import { renderWithProviders } from '../Mocks/ProviderWrapper';

// Regular imports
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { Nav } from '../../Components/Nav';

// Mock individual components to return null for testing
vi.mock('../../Pages/Dash', () => ({
  Dash: () => null,
}));

vi.mock('../../Pages/NumaChat', () => ({
  NumaChat: () => null,
}));

vi.mock('../../Pages/S3Uploader', () => ({
  S3Uploader: () => null,
}));

vi.mock('../../Pages/CompanyInfo', () => ({
  CompanyInfo: () => null,
}));

vi.mock('../../Pages/UserManagement', () => ({
  default: () => null,
}));

vi.mock('../../Pages/AppDetail', () => ({
  default: () => null,
}));

vi.mock('../../utils/navigation', () => ({
  reloadFavourites: vi.fn(),
}));

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

  describe('Standard User Navigation', () => {
    beforeEach(() => {
      setMockUser('standard'); // Standard user only has chat feature
    });

    it('renders navigation items for standard user', async () => {
      renderWithProviders(<Nav />);

      // Wait for route config to load
      await waitFor(() => {
        expect(screen.getByText('Dash')).toBeInTheDocument();
      });

      expect(screen.getByText('Favs')).toBeInTheDocument();
      expect(screen.getByText('Chat')).toBeInTheDocument();
      expect(screen.getByText('Log out')).toBeInTheDocument();
      expect(screen.getByText('v0.1')).toBeInTheDocument();

      // Standard user should NOT see admin features
      expect(screen.queryByText('User Management')).not.toBeInTheDocument();
    });

    it('handles navigation clicks correctly for standard user', async () => {
      renderWithProviders(<Nav />);

      await waitFor(() => {
        expect(screen.getByText('Dash')).toBeInTheDocument();
      });

      // Test dashboard navigation
      fireEvent.click(screen.getByText('Dash'));
      expect(mockNavigate).toHaveBeenCalledWith('/dash');

      // Test chat navigation
      fireEvent.click(screen.getByText('Chat'));
      expect(mockNavigate).toHaveBeenCalledWith('/chat');

      // Test logout
      fireEvent.click(screen.getByText('Log out'));
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  describe('Admin User Navigation', () => {
    beforeEach(() => {
      setMockUser('admin'); // Admin has all features
    });

    it('renders navigation items for admin user', async () => {
      renderWithProviders(<Nav />);

      // Wait for route config to load
      await waitFor(() => {
        expect(screen.getByText('Dash')).toBeInTheDocument();
      });

      expect(screen.getByText('Favs')).toBeInTheDocument();
      expect(screen.getByText('Chat')).toBeInTheDocument();
      expect(screen.getByText('Files')).toBeInTheDocument();
      expect(screen.getByText('Company')).toBeInTheDocument();
      expect(screen.getByText('Log out')).toBeInTheDocument();
      expect(screen.getByText('v0.1')).toBeInTheDocument();
    });

    it('renders navigation items in correct order: Dash, Favs, Chat, Company, Files', async () => {
      renderWithProviders(<Nav />);

      // Wait for route config to load
      await waitFor(() => {
        expect(screen.getByText('Dash')).toBeInTheDocument();
      });

      // Get all navigation items (excluding footer items like logout and version)
      const navItems = screen.getAllByRole('button').filter((button) => {
        const text = button.textContent;
        return ['Dash', 'Favs', 'Chat', 'Company', 'Files'].includes(text);
      });

      // Extract the text content to verify order
      const navItemTexts = navItems.map((item) => item.textContent);

      // Filter out any missing items but verify the order of existing ones
      const expectedOrder = ['Dash', 'Favs', 'Chat', 'Company', 'Files'];
      const actualOrderFiltered = expectedOrder.filter((item) => navItemTexts.includes(item));
      const actualOrder = navItemTexts.filter((text) => expectedOrder.includes(text));

      expect(actualOrder).toEqual(actualOrderFiltered);

      // Verify that all expected main nav items are present for admin
      expect(actualOrder).toContain('Dash');
      expect(actualOrder).toContain('Favs');
      expect(actualOrder).toContain('Chat');
      expect(actualOrder).toContain('Company');
      expect(actualOrder).toContain('Files');

      // Verify User Management is not in main nav (it should be footer-only)
      const mainNavTexts = navItems.map((item) => item.textContent);
      expect(mainNavTexts).not.toContain('User Management');
    });

    it('handles navigation clicks correctly for admin user', async () => {
      renderWithProviders(<Nav />);

      await waitFor(() => {
        expect(screen.getByText('Dash')).toBeInTheDocument();
      });

      // Test dashboard navigation
      fireEvent.click(screen.getByText('Dash'));
      expect(mockNavigate).toHaveBeenCalledWith('/dash');

      // Test chat navigation
      fireEvent.click(screen.getByText('Chat'));
      expect(mockNavigate).toHaveBeenCalledWith('/chat');

      // Test files navigation
      fireEvent.click(screen.getByText('Files'));
      expect(mockNavigate).toHaveBeenCalledWith('/upload');

      // Test company navigation
      fireEvent.click(screen.getByText('Company'));
      expect(mockNavigate).toHaveBeenCalledWith('/company-info');

      // Test logout
      fireEvent.click(screen.getByText('Log out'));
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  describe('Mobile Navigation', () => {
    beforeEach(() => {
      // Set mobile width
      window.innerWidth = 768;
      fireEvent(window, new Event('resize'));
      setMockUser('admin'); // Use admin for mobile tests to see all features
    });

    it('should render mobile navigation when screen width <= 768px', () => {
      renderWithProviders(<Nav />);

      // Check for mobile menu button using data-testid
      const dropdownButton = screen.getByTestId('mobile-menu-button');
      expect(dropdownButton).toHaveAttribute('id', 'nav-dropdown');
      expect(dropdownButton).toHaveClass('dropdown-toggle');
    });

    it('should handle mobile menu interactions', async () => {
      renderWithProviders(<Nav />);

      // Wait for navItems to load first
      await waitFor(() => {
        expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
      });

      // Open mobile menu using data-testid
      const menuButton = screen.getByTestId('mobile-menu-button');
      fireEvent.click(menuButton);

      // Wait for dropdown menu to be visible and check for menu items
      await waitFor(() => {
        const dashItem = screen.getByRole('button', { name: /Dash/i });
        expect(dashItem).toBeInTheDocument();
      });

      expect(screen.getByRole('button', { name: /Favs/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Chat/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Files/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Company/i })).toBeInTheDocument();
    });

    it('should handle mobile menu navigation clicks correctly', async () => {
      renderWithProviders(<Nav />);

      // Wait for navItems to load
      await waitFor(() => {
        expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
      });

      // Open mobile menu
      const menuButton = screen.getByTestId('mobile-menu-button');
      fireEvent.click(menuButton);

      // Wait for dropdown menu to be visible
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Dash/i })).toBeInTheDocument();
      });

      // Test dashboard navigation
      fireEvent.click(screen.getByRole('button', { name: /Dash/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/dash');

      // Reopen menu for next test
      fireEvent.click(menuButton);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Chat/i })).toBeInTheDocument();
      });

      // Test chat navigation
      fireEvent.click(screen.getByRole('button', { name: /Chat/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/chat');

      // Reopen menu for files test
      fireEvent.click(menuButton);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Files/i })).toBeInTheDocument();
      });

      // Test files navigation
      fireEvent.click(screen.getByRole('button', { name: /Files/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/upload');

      // Test logout - should be visible in dropdown
      fireEvent.click(menuButton);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
      });

      const logoutButton = screen.getByRole('button', { name: 'Log out' });
      fireEvent.click(logoutButton);
      expect(mockLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });

    it('should render mobile navigation elements correctly', async () => {
      renderWithProviders(<Nav />);

      // Check for mobile-specific elements
      const menuButton = screen.getByTestId('mobile-menu-button');
      expect(menuButton).toBeInTheDocument();
      expect(menuButton).toHaveClass('dropdown-toggle');

      // Wait for navItems to load
      await waitFor(() => {
        expect(menuButton).toBeInTheDocument();
      });

      // Check that the mobile navigation structure is correct
      expect(screen.getByRole('navigation')).toBeInTheDocument();
      expect(screen.getByText('Numa')).toBeInTheDocument();
      expect(menuButton).toHaveAttribute('id', 'nav-dropdown');

      // Verify it's the mobile version by checking for mobile-specific classes
      const nav = screen.getByRole('navigation');
      expect(nav).toHaveClass('mobile-nav');
    });
  });

  describe('Responsive Behavior', () => {
    beforeEach(() => {
      setMockUser('standard');
    });

    it('should handle window resize from desktop to mobile', async () => {
      // Start with desktop width
      window.innerWidth = 1024;
      renderWithProviders(<Nav />);

      await waitFor(() => {
        expect(screen.getByText('Dash')).toBeInTheDocument();
      });

      // Initially should show desktop nav
      expect(screen.queryByTestId('mobile-menu-button')).not.toBeInTheDocument();

      // Simulate resize to mobile width
      window.innerWidth = 768;
      fireEvent(window, new Event('resize'));

      // Should now show mobile nav
      await waitFor(() => {
        expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
      });
      expect(screen.queryByText('Dash')).not.toBeInTheDocument();
    });

    it('should handle window resize from mobile to desktop', async () => {
      // Start with mobile width
      window.innerWidth = 768;
      renderWithProviders(<Nav />);

      // Initially should show mobile nav
      expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
      expect(screen.queryByText('Dash')).not.toBeInTheDocument();

      // Simulate resize to desktop width
      window.innerWidth = 1024;
      fireEvent(window, new Event('resize'));

      // Should now show desktop nav
      await waitFor(() => {
        expect(screen.getByText('Dash')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('mobile-menu-button')).not.toBeInTheDocument();
    });
  });
});
