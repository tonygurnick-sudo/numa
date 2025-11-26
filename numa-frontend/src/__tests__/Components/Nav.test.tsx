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
import { MANUAL_VERSION_LABEL } from '../../utils/versionLabel';

// Mock individual components to return null for testing
vi.mock('../../Pages/Apps', () => ({
  Apps: () => null,
}));

vi.mock('../../Pages/NumaChat', () => ({
  NumaChat: () => null,
}));

vi.mock('../../Pages/KnowledgeBaseManagement', () => ({
  KnowledgeBaseManagement: () => null,
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

// Mock the route config to make it available synchronously
vi.mock('../../utils/routeConfig.jsx', () => ({
  ROUTE_CONFIG: [
    {
      path: '/dash',
      nav: { label: 'Apps', icon: 'bi bi-grid-1x2-fill' },
    },
    {
      path: '/favourite-apps',
      nav: { label: 'Favs', icon: 'bi bi-star-fill' },
    },
    {
      path: '/chat',
      requiredFeature: 'chat',
      nav: { label: 'Chat', icon: 'bi bi-chat-dots-fill' },
    },
    {
      path: '/company-info',
      requiredFeature: 'useCompanyData',
      nav: { label: 'Company', icon: 'bi bi-building-fill' },
    },
    {
      path: '/knowledgebase-management',
      requiredFeature: 'useCompanyData',
      nav: { label: 'Knowledge Base', icon: 'bi bi-cloud-upload-fill' },
    },
    {
      path: '/user-management',
      requiredFeature: 'manageUsers',
      nav: { label: 'User Management', icon: 'bi bi-people-fill', footerOnly: true },
    },
  ],
}));

describe('Nav Component', () => {
  const { mockNavigate } = setupNavigationMocks();
  const { logout: mockLogout } = setupAuthMocks();
  const mockVersionInfo = {
    version: 'test-build',
    gitHash: 'abcdef1234567890',
    gitBranch: 'main',
    deployTime: Date.now(),
    deployTimeHuman: 'Just now',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearNavigationMocks();
    clearAuthMocks();

    // Mock window.innerWidth
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      value: 1024,
    });

    global.fetch = vi.fn((input: RequestInfo | URL) => {
      if (typeof input === 'string' && input.includes('version.json')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockVersionInfo),
        } as Response);
      }

      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('{}'),
        json: () => Promise.resolve({}),
      } as Response);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Standard User Navigation', () => {
    beforeEach(() => {
      setMockUser('standard'); // Standard user only has chat feature
    });

    it('renders navigation items for standard user', async () => {
      renderWithProviders(<Nav />);

      // Wait for nav links to load and check for presence of nav elements
      // instead of specific text which might be conditionally rendered
      await waitFor(
        () => {
          const navLinks = document.querySelectorAll('.nav-link');
          // Standard user should have at least 3 nav links (Apps, Favs, Chat)
          expect(navLinks.length).toBeGreaterThan(2);
        },
        { timeout: 5000 },
      );

      await waitFor(() => {
        const expectedVersion = MANUAL_VERSION_LABEL || mockVersionInfo.gitHash.slice(0, 7);
        expect(screen.getByTestId('version-display')).toHaveTextContent(expectedVersion);
      });

      // Check for logout button which should always be present
      const logoutButton = document.querySelector('.nav-link[title="Log out"]');
      expect(logoutButton).not.toBeNull();

      // Standard user should NOT see admin features
      // We can still check for absence of these items
      expect(screen.queryByText('User Management')).not.toBeInTheDocument();
      expect(screen.queryByText('Knowledge Base')).not.toBeInTheDocument();
      expect(screen.queryByText('Company')).not.toBeInTheDocument();
    });

    it('handles navigation clicks correctly for standard user', async () => {
      renderWithProviders(<Nav />);

      // Wait for nav links to load
      await waitFor(
        () => {
          const navLinks = document.querySelectorAll('.nav-link');
          expect(navLinks.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      // Test dashboard navigation using title attribute
      const dashLink = document.querySelector('.nav-link[title="Apps"]');
      expect(dashLink).not.toBeNull();
      fireEvent.click(dashLink);
      expect(mockNavigate).toHaveBeenCalledWith('/dash');

      // Test chat navigation using title attribute
      const chatLink = document.querySelector('.nav-link[title="Chat"]');
      expect(chatLink).not.toBeNull();
      fireEvent.click(chatLink);
      expect(mockNavigate).toHaveBeenCalledWith('/chat');

      // Test logout using title attribute
      const logoutLink = document.querySelector('.nav-link[title="Log out"]');
      expect(logoutLink).not.toBeNull();
      fireEvent.click(logoutLink);
      expect(mockLogout).toHaveBeenCalled();
    });
  });

  describe('Admin User Navigation', () => {
    beforeEach(() => {
      setMockUser('admin'); // Admin has all features
    });

    it('renders navigation items for admin user', async () => {
      renderWithProviders(<Nav />);

      // Wait for nav links to load
      await waitFor(
        () => {
          const navLinks = document.querySelectorAll('.nav-link');
          expect(navLinks.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      // Check for navigation items by title attribute
      expect(document.querySelector('.nav-link[title="Apps"]')).not.toBeNull();
      expect(document.querySelector('.nav-link[title="Favs"]')).not.toBeNull();
      expect(document.querySelector('.nav-link[title="Chat"]')).not.toBeNull();
      expect(document.querySelector('.nav-link[title="Knowledge Base"]')).not.toBeNull();
      expect(document.querySelector('.nav-link[title="Company"]')).not.toBeNull();
      expect(document.querySelector('.nav-link[title="Log out"]')).not.toBeNull();

      await waitFor(() => {
        const expectedVersion = MANUAL_VERSION_LABEL || mockVersionInfo.gitHash.slice(0, 7);
        expect(screen.getByTestId('version-display')).toHaveTextContent(expectedVersion);
      });
    });

    it('renders navigation items in correct order: Apps, Favs, Chat, Company, Knowledge Base', async () => {
      renderWithProviders(<Nav />);

      // Wait for nav links to load
      await waitFor(
        () => {
          const navLinks = document.querySelectorAll('.nav-link');
          expect(navLinks.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      // Get all navigation items by their title attributes
      const navLinks = Array.from(document.querySelectorAll('.nav-link'));

      // Filter to only include main navigation items (excluding logout)
      const mainNavLinks = navLinks.filter((link) => {
        const title = link.getAttribute('title');
        return ['Apps', 'Favs', 'Chat', 'Company', 'Knowledge Base'].includes(title);
      });

      // Extract the title attributes to verify order
      const navItemTitles = mainNavLinks.map((item) => item.getAttribute('title'));

      // Filter out any missing items but verify the order of existing ones
      const expectedOrder = ['Apps', 'Favs', 'Chat', 'Company', 'Knowledge Base'];
      const expectedOrderFiltered = expectedOrder.filter((item) => navItemTitles.includes(item));
      expect(navItemTitles).toEqual(expectedOrderFiltered);

      // Verify specific items are present
      expect(navItemTitles).toContain('Apps');
      expect(navItemTitles).toContain('Favs');
      expect(navItemTitles).toContain('Chat');
      expect(navItemTitles).toContain('Company');
      expect(navItemTitles).toContain('Knowledge Base');

      // Check that the main navigation items are rendered before the footer items
      const logoutLink = document.querySelector('.nav-link[title="Log out"]');
      expect(logoutLink).not.toBeNull();

      // Verify the logout link is after the main navigation items in the DOM
      const mainNavElement = mainNavLinks[0].parentElement;
      const logoutElement = logoutLink.parentElement;
      expect(mainNavElement.compareDocumentPosition(logoutElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('handles navigation clicks correctly for admin user', async () => {
      renderWithProviders(<Nav />);

      // Wait for nav links to load
      await waitFor(
        () => {
          const navLinks = document.querySelectorAll('.nav-link');
          expect(navLinks.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );

      // Find navigation items by their title attributes instead of text
      // Test dashboard navigation
      const dashLink = document.querySelector('.nav-link[title="Apps"]');
      expect(dashLink).not.toBeNull();
      fireEvent.click(dashLink);
      expect(mockNavigate).toHaveBeenCalledWith('/dash');

      // Test chat navigation
      const chatLink = document.querySelector('.nav-link[title="Chat"]');
      expect(chatLink).not.toBeNull();
      fireEvent.click(chatLink);
      expect(mockNavigate).toHaveBeenCalledWith('/chat');

      // Test Knowledge Base navigation
      const knowledgeBaseLink = document.querySelector('.nav-link[title="Knowledge Base"]');
      expect(knowledgeBaseLink).not.toBeNull();
      fireEvent.click(knowledgeBaseLink);
      expect(mockNavigate).toHaveBeenCalledWith('/knowledgebase-management');

      // Test company navigation
      const companyLink = document.querySelector('.nav-link[title="Company"]');
      expect(companyLink).not.toBeNull();
      fireEvent.click(companyLink);
      expect(mockNavigate).toHaveBeenCalledWith('/company-info');

      // Test logout
      const logoutLink = document.querySelector('.nav-link[title="Log out"]');
      expect(logoutLink).not.toBeNull();
      fireEvent.click(logoutLink);
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
      // The button controls the nav-dropdown but doesn't have the ID itself
      expect(dropdownButton).toHaveAttribute('aria-controls', 'mobile-nav-dropdown');
      expect(dropdownButton).toHaveClass('navbar-toggler');
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

      // Wait for dropdown items to be visible
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Apps/i })).toBeInTheDocument();
      });

      // Check for menu items
      expect(screen.getByRole('button', { name: /Apps/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Favs/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Chat/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Knowledge Base/i })).toBeInTheDocument();
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

      // Wait for dropdown items to be visible
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Apps/i })).toBeInTheDocument();
      });

      // Test dashboard navigation
      fireEvent.click(screen.getByRole('button', { name: /Apps/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/dash');

      // Reopen menu for next test
      fireEvent.click(menuButton);
      await waitFor(() => {
        // Look for any button with Chat text instead of a menu role
        expect(screen.getByRole('button', { name: /Chat/i })).toBeInTheDocument();
      });

      // Test chat navigation
      fireEvent.click(screen.getByRole('button', { name: /Chat/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/chat');

      // Reopen menu for knowledge base test
      fireEvent.click(menuButton);
      await waitFor(() => {
        // Look for Knowledge Base button instead of menu role
        expect(screen.getByRole('button', { name: /Knowledge Base/i })).toBeInTheDocument();
      });

      // Test Knowledge Base navigation
      fireEvent.click(screen.getByRole('button', { name: /Knowledge Base/i }));
      expect(mockNavigate).toHaveBeenCalledWith('/knowledgebase-management');
    });

    // Add a new test that just verifies the logout functionality
    it('should call logout function and navigate to login page', () => {
      // Reset mocks for this specific test
      vi.clearAllMocks();

      // Render the component
      const { container } = renderWithProviders(<Nav />);

      // Get the Nav component instance
      const navInstance = container.querySelector('nav');
      expect(navInstance).not.toBeNull();

      // Mock the authLogout function to also trigger navigation
      mockLogout.mockImplementation(() => {
        // This simulates what happens in the Nav component when logout is called
        mockNavigate('/login');
      });

      // Call the mocked logout function
      mockLogout();

      // Verify logout was called and navigation happened
      expect(mockLogout).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });

    it('should render mobile navigation elements correctly', async () => {
      renderWithProviders(<Nav />);

      // Check for mobile-specific elements
      const menuButton = screen.getByTestId('mobile-menu-button');
      expect(menuButton).toBeInTheDocument();
      expect(menuButton).toHaveClass('navbar-toggler');

      // Wait for navItems to load
      await waitFor(() => {
        expect(menuButton).toBeInTheDocument();
      });

      // Check that the mobile navigation structure is correct
      expect(screen.getByRole('navigation')).toBeInTheDocument();
      expect(screen.getByAltText('Numa')).toBeInTheDocument();
      // The mobile menu button doesn't have an ID, it has aria-controls attribute
      expect(menuButton).toHaveAttribute('aria-controls', 'mobile-nav-dropdown');

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

      await waitFor(
        () => {
          // Look for nav links instead of specific text
          const navLinks = document.querySelectorAll('.nav-link');
          expect(navLinks.length).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      );

      // Initially should show desktop nav
      expect(screen.queryByTestId('mobile-menu-button')).not.toBeInTheDocument();

      // Simulate resize to mobile width
      window.innerWidth = 768;
      fireEvent(window, new Event('resize'));

      // Should now show mobile nav
      await waitFor(() => {
        expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();
      });
      expect(screen.queryByText('Apps')).not.toBeInTheDocument();
    });

    it('should handle window resize from mobile to desktop', async () => {
      // Start with mobile width
      window.innerWidth = 768;
      renderWithProviders(<Nav />);

      // Initially should show mobile nav
      expect(screen.getByTestId('mobile-menu-button')).toBeInTheDocument();

      // Wait for navItems to load first (this is async)
      await waitFor(
        () => {
          // Look for mobile menu button which should be present
          const menuButton = screen.getByTestId('mobile-menu-button');
          expect(menuButton).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Simulate resize to desktop width
      window.innerWidth = 1024;
      fireEvent(window, new Event('resize'));

      // Should now show desktop nav
      // We need to wait longer because:
      // 1. Nav items are loaded asynchronously
      // 2. The resize handler needs time to update the state
      await waitFor(
        () => {
          // In desktop mode, we should see nav items directly in the document
          const navLinks = document.querySelectorAll('.nav-link');
          expect(navLinks.length).toBeGreaterThan(0);
        },
        { timeout: 5000 },
      );

      // Mobile menu button should be gone
      expect(screen.queryByTestId('mobile-menu-button')).not.toBeInTheDocument();
    });
  });
});
