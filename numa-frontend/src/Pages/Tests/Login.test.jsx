/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render } from '@testing-library/react';
import { waitFor, screen, fireEvent } from '@testing-library/react/pure';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { NumaLogin } from '../Login';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from '../../Providers/AuthProvider';

// Mock useNavigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Create mock functions
const mockLogin = vi.fn().mockResolvedValue({ requiresNewPassword: false });
const mockSetNewPassword = vi.fn().mockResolvedValue({});

// Mock the auth functions but keep the actual Provider
vi.mock('../Providers/AuthProvider', async () => {
  const actual = await vi.importActual('../Providers/AuthProvider');
  return {
    ...actual,
    useAuth: () => ({
      login: mockLogin,
      setNewPassword: mockSetNewPassword,
      isAuthenticated: false,
      loading: false,
      error: null,
      user: null,
      setError: vi.fn(),
      setLoading: vi.fn(),
      setNewPasswordRequired: vi.fn(),
      newPasswordRequired: false,
      completeNewPassword: vi.fn(),
      setUser: vi.fn(),
      setIsAuthenticated: vi.fn(),
    }),
  };
});

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  mockLogin.mockReset().mockResolvedValue({ requiresNewPassword: false });
  mockSetNewPassword.mockReset().mockResolvedValue({});
});

const renderWithProviders = (ui, { container } = {}) => {
  return render(
    <AuthProvider>
      <BrowserRouter>{ui}</BrowserRouter>
    </AuthProvider>,
    { container },
  );
};

describe('NumaLogin Component', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root');
  });

  describe('Initial Rendering', () => {
    it('should render login form with all elements', () => {
      renderWithProviders(<NumaLogin />, { container });

      expect(screen.getByText('Numa Login')).toBeInTheDocument();
      expect(screen.getByLabelText('Username')).toBeInTheDocument();
      expect(screen.getByLabelText('Password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
      expect(screen.getByText('Forgot password')).toBeInTheDocument();
    });

    it('should have empty form fields initially', () => {
      renderWithProviders(<NumaLogin />, { container });

      expect(screen.getByLabelText('Username')).toHaveValue('');
      expect(screen.getByLabelText('Password')).toHaveValue('');
    });
  });

  describe('Form Interactions', () => {
    it('should update input values when typing', () => {
      renderWithProviders(<NumaLogin />, { container });

      const usernameInput = screen.getByLabelText('Username');
      const passwordInput = screen.getByLabelText('Password');

      fireEvent.change(usernameInput, { target: { value: 'testuser' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });

      expect(usernameInput).toHaveValue('testuser');
      expect(passwordInput).toHaveValue('password123');
    });

    it('should clear inputs after successful login', async () => {
      renderWithProviders(<NumaLogin />, {
        container,
      });

      const usernameInput = screen.getByLabelText('Username');
      const passwordInput = screen.getByLabelText('Password');
      const loginButton = screen.getByRole('button', { name: 'Login' });

      fireEvent.change(usernameInput, { target: { value: 'testuser' } });
      fireEvent.change(passwordInput, { target: { value: 'password123' } });
      fireEvent.click(loginButton);

      await waitFor(() => {
        expect(screen.getByText('Login successful.')).toBeInTheDocument();
      });

      await waitFor(() => {
        expect(usernameInput).toHaveValue('');
        expect(passwordInput).toHaveValue('');
      });
    });
  });

  describe('Authentication Flow', () => {
    it('should handle successful login', async () => {
      renderWithProviders(<NumaLogin />, {
        container,
      });

      fireEvent.change(screen.getByLabelText('Username'), {
        target: { value: 'testuser' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Login' }));

      await waitFor(() => {
        expect(screen.getByText('Login successful.')).toBeInTheDocument();
      });

      await waitFor(
        () => {
          expect(mockNavigate).toHaveBeenCalledWith('/dash');
        },
        { timeout: 2000 },
      );
    });

    it('should handle login error', async () => {
      mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));
      renderWithProviders(<NumaLogin />, { container });

      fireEvent.click(screen.getByRole('button', { name: 'Login' }));

      await waitFor(() => {
        expect(screen.getByText('Invalid credentials')).toBeInTheDocument();
      });
    });

    it('should handle new password requirement', async () => {
      // Mock login to require new password
      mockLogin.mockResolvedValueOnce({ requiresNewPassword: true });
      mockSetNewPassword.mockResolvedValueOnce({});

      renderWithProviders(<NumaLogin />, { container });

      // Initial login
      fireEvent.change(screen.getByLabelText('Username'), {
        target: { value: 'testuser' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Login' }));

      // Wait for new password form
      await waitFor(() => {
        expect(
          screen.getByText(
            'You need to set a new password. Please enter a new password below.',
          ),
        ).toBeInTheDocument();
      });

      // Set new password
      fireEvent.change(screen.getByLabelText('New Password'), {
        target: { value: 'newpassword123' },
      });
      fireEvent.change(screen.getByLabelText('Confirm New Password'), {
        target: { value: 'newpassword123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

      await waitFor(() => {
        expect(mockSetNewPassword).toHaveBeenCalledWith(
          'testuser',
          'newpassword123',
        );
      });
    });

    it('should handle password mismatch during reset', async () => {
      // Mock login to require new password
      mockLogin.mockResolvedValueOnce({ requiresNewPassword: true });

      renderWithProviders(<NumaLogin />, { container });

      // Initial login
      fireEvent.change(screen.getByLabelText('Username'), {
        target: { value: 'testuser' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Login' }));

      await waitFor(() => {
        expect(screen.getByLabelText('New Password')).toBeInTheDocument();
      });

      // Submit mismatched passwords
      fireEvent.change(screen.getByLabelText('New Password'), {
        target: { value: 'newpassword123' },
      });
      fireEvent.change(screen.getByLabelText('Confirm New Password'), {
        target: { value: 'differentpassword' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

      await waitFor(() => {
        expect(screen.getByText("Passwords don't match")).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('should show loading state during login', async () => {
      renderWithProviders(<NumaLogin />, { container });

      fireEvent.click(screen.getByRole('button', { name: 'Login' }));

      expect(screen.getByText('Logging In...')).toBeInTheDocument();

      await waitFor(
        () => {
          expect(screen.queryByText('Logging In...')).not.toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });

    it('should show loading state during password reset', async () => {
      // Mock login to require new password
      mockLogin.mockResolvedValueOnce({ requiresNewPassword: true });
      mockSetNewPassword.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );

      renderWithProviders(<NumaLogin />, { container });

      // Initial login
      fireEvent.change(screen.getByLabelText('Username'), {
        target: { value: 'testuser' },
      });
      fireEvent.change(screen.getByLabelText('Password'), {
        target: { value: 'password123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Login' }));

      await waitFor(() => {
        expect(screen.getByLabelText('New Password')).toBeInTheDocument();
      });

      // Submit new password
      fireEvent.change(screen.getByLabelText('New Password'), {
        target: { value: 'newpassword123' },
      });
      fireEvent.change(screen.getByLabelText('Confirm New Password'), {
        target: { value: 'newpassword123' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

      expect(screen.getByText('Setting New Password...')).toBeInTheDocument();
    });
  });
});
