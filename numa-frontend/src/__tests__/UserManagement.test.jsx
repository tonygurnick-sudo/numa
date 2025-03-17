import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import UserManagement from '../Pages/UserManagement';
import { useAuth } from '../Providers/AuthProvider';
import { UserManagementUtils } from '../utils/userManagementUtils';

// Mock the AuthProvider
vi.mock('../Providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

// Mock the UserManagementUtils
vi.mock('../utils/userManagementUtils', () => ({
  UserManagementUtils: vi.fn(),
}));

// Mock React's useEffect
vi.mock('react', async () => {
  const actual = await vi.importActual('react');
  return {
    ...actual,
    useEffect: vi.fn().mockImplementation((callback, deps) => {
      // Only run the effect if it's not the initial fetchUsers effect (which has empty deps)
      if (deps && deps.length > 0) {
        return actual.useEffect(callback, deps);
      }
    }),
  };
});

// Mock the Nav component
vi.mock('../Components/Nav', () => ({
  Nav: () => <div data-testid="nav-component">Nav Component</div>,
}));

// Mock the LayoutDashboard component
vi.mock('../Layouts/LayoutDashboard', () => ({
  LayoutDashboard: ({ children }) => <div data-testid="layout-dashboard">{children}</div>,
}));

// Mock sessionStorage
const mockSessionStorage = {
  getItem: vi.fn(),
};

Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
});

describe('UserManagement Component', () => {
  const mockGetCredentials = vi.fn();
  const mockGetIdentityPoolCredentials = vi.fn();
  const mockCreateUser = vi.fn();
  const mockListUsers = vi.fn();
  const mockEmail = 'test@example.com';
  const mockTempPassword = 'WelcomeAbc123!';
  const mockUserPoolId = 'us-east-1_testpool';
  const mockRegion = 'us-east-1';

  beforeEach(() => {
    vi.resetAllMocks();

    // Setup AuthProvider mock
    useAuth.mockReturnValue({
      getCredentials: mockGetCredentials,
      getIdentityPoolCredentials: mockGetIdentityPoolCredentials,
    });

    // Setup UserManagementUtils mock
    UserManagementUtils.mockImplementation(() => ({
      createUser: mockCreateUser,
      listUsers: mockListUsers,
    }));

    // Setup sessionStorage mock
    mockSessionStorage.getItem.mockImplementation((key) => {
      if (key === 'USER_POOL_ID') return mockUserPoolId;
      if (key === 'REGION') return mockRegion;
      return null;
    });

    // Setup createUser mock response
    mockCreateUser.mockResolvedValue({
      user: {
        Username: 'user-uuid',
        Attributes: [
          { Name: 'email', Value: mockEmail },
          { Name: 'email_verified', Value: 'true' },
          { Name: 'sub', Value: 'user-uuid' },
        ],
        UserStatus: 'FORCE_CHANGE_PASSWORD',
      },
      temporaryPassword: mockTempPassword,
    });

    // Setup listUsers mock response
    mockListUsers.mockResolvedValue([
      {
        username: 'user1',
        email: 'user1@example.com',
        enabled: true,
        status: 'CONFIRMED',
        created: new Date(),
      },
    ]);

    // Setup getIdentityPoolCredentials mock response
    mockGetIdentityPoolCredentials.mockResolvedValue({
      accessKeyId: 'test',
      secretAccessKey: 'test',
    });
  });

  it('renders the component correctly', async () => {
    await act(async () => {
      render(<UserManagement />);
    });

    // Check if the title is rendered
    expect(screen.getByText('User Management')).toBeInTheDocument();

    // Check if the form is rendered
    expect(screen.getByText('Create New User')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter email')).toBeInTheDocument();
    expect(screen.getByText('Create User')).toBeInTheDocument();

    // Check if the users section is rendered
    expect(screen.getByText('Current Users')).toBeInTheDocument();
  });

  it('creates a user successfully', async () => {
    await act(async () => {
      render(<UserManagement />);
    });

    // Fill in the email field
    const emailInput = screen.getByPlaceholderText('Enter email');
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: mockEmail } });
    });

    // Submit the form
    const submitButton = screen.getByText('Create User');
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Wait for the success message
    await waitFor(() => {
      expect(screen.getByText('User created successfully!')).toBeInTheDocument();
    });

    // Check if the temporary password is displayed
    const tempPasswordLabel = screen.getAllByText(/temporary password/i, { exact: false }).find((el) => {
      return el.tagName === 'STRONG';
    });
    expect(tempPasswordLabel).toBeInTheDocument();
    expect(screen.getByText(mockTempPassword)).toBeInTheDocument();

    // Check if the username (email) is displayed
    const usernameLabel = screen.getAllByText(/username \(email\)/i, { exact: false }).find((el) => {
      return el.tagName === 'STRONG';
    });
    expect(usernameLabel).toBeInTheDocument();
    expect(screen.getByText(mockEmail)).toBeInTheDocument();

    // Verify the API calls
    expect(mockGetIdentityPoolCredentials).toHaveBeenCalled();
    expect(UserManagementUtils).toHaveBeenCalledWith(mockRegion, expect.anything());
    expect(mockCreateUser).toHaveBeenCalledWith(mockEmail, mockUserPoolId);

    // Wait for the user list to be refreshed
    await waitFor(() => {
      expect(mockListUsers).toHaveBeenCalledWith(mockUserPoolId);
    });
  });

  it('handles user creation error', async () => {
    // Reset mocks before this test
    vi.clearAllMocks();
    // Setup createUser to throw an error
    const errorMessage = 'A user with this email already exists';
    mockCreateUser.mockRejectedValueOnce(new Error(errorMessage));

    await act(async () => {
      render(<UserManagement />);
    });

    // Verify listUsers was not called during initial render (our useEffect mock prevents this)
    expect(mockListUsers).not.toHaveBeenCalled();

    // Fill in the email field
    const emailInput = screen.getByPlaceholderText('Enter email');
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: mockEmail } });
    });

    // Submit the form
    const submitButton = screen.getByText('Create User');
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Wait for the error message
    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    // Verify the API calls
    expect(mockGetIdentityPoolCredentials).toHaveBeenCalled();
    expect(UserManagementUtils).toHaveBeenCalledWith(mockRegion, expect.anything());
    expect(mockCreateUser).toHaveBeenCalledWith(mockEmail, mockUserPoolId);

    // The user list should not be refreshed after error
    expect(mockListUsers).not.toHaveBeenCalled();
  });

  it('tests the copy functionality', async () => {
    // Mock clipboard API
    const originalClipboard = navigator.clipboard;
    const mockClipboard = {
      writeText: vi.fn(),
    };
    Object.defineProperty(navigator, 'clipboard', {
      value: mockClipboard,
      writable: true,
    });

    // Mock window.alert
    const originalAlert = window.alert;
    window.alert = vi.fn();

    await act(async () => {
      render(<UserManagement />);
    });

    // Fill in the email field and submit
    const emailInput = screen.getByPlaceholderText('Enter email');
    await act(async () => {
      fireEvent.change(emailInput, { target: { value: mockEmail } });
    });

    const submitButton = screen.getByRole('button', { name: /create user/i });
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Wait for the success message
    await waitFor(() => {
      expect(screen.getByText('User created successfully!')).toBeInTheDocument();
    });

    // Find and click the copy buttons
    const copyButtons = screen.getAllByText('Copy');
    expect(copyButtons).toHaveLength(2); // One for email, one for password

    // Click the email copy button
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });
    expect(mockClipboard.writeText).toHaveBeenCalledWith(mockEmail);
    expect(window.alert).toHaveBeenCalledWith('Email copied to clipboard!');

    // Click the password copy button
    await act(async () => {
      fireEvent.click(copyButtons[1]);
    });
    expect(mockClipboard.writeText).toHaveBeenCalledWith(mockTempPassword);
    expect(window.alert).toHaveBeenCalledWith('Password copied to clipboard!');

    // Restore original implementations
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
    });
    window.alert = originalAlert;
  });
});
