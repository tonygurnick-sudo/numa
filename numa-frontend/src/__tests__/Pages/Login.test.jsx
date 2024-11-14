/**
 * @vitest-environment jsdom
 */

import { navigationHandlers } from '../Mocks/NavigationMock';
import { authHandlers } from '../Mocks/AuthMock';

import { waitFor, screen, fireEvent } from '@testing-library/react/pure';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterAll,
} from 'vitest';
import '@testing-library/jest-dom';
import { NumaLogin } from '../../Pages/Login';
import { renderWithProviders, clearAllMocks } from '../Mocks/ProviderWrapper';

// Use navigationHandlers.mockNavigate instead of mockNavigate
const { mockNavigate } = navigationHandlers;

// Create mock auth functions
const { login: mockLogin, setNewPassword: mockSetNewPassword } = authHandlers;

// Configure Vitest to use a custom error formatter
vi.setConfig({
  testTimeout: 10000,
  prettifyTestError: (error) => {
    if (error.name === 'TestingLibraryElementError') {
      return error.message.split('\n')[0]; // Only show the first line of the error
    }
    return error.message;
  },
});

// Add custom error handler to suppress full DOM output
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (/Warning.*not wrapped in act/.test(args[0])) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// Add custom matcher to reduce error output
expect.extend({
  async toBeVisibleInDocument(received) {
    try {
      expect(received).toBeInTheDocument();
      expect(received).toBeVisible();
      return {
        message: () => `expected element to be visible in document`,
        pass: true,
      };
    } catch (error) {
      return {
        message: () => `element not found in document: ${error.message}`,
        pass: false,
      };
    }
  },
});

describe('NumaLogin Component', () => {
  beforeEach(() => {
    clearAllMocks();
  });

  it('should handle successful login flow', async () => {
    // Setup mock to resolve successfully
    mockLogin.mockResolvedValueOnce({ success: true });

    renderWithProviders(<NumaLogin />);

    // Fill in form
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'testuser' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    // Verify login was called and navigation happened
    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123');
      expect(screen.getByRole('alert')).toHaveTextContent('Login successful');
      expect(mockNavigate).toHaveBeenCalledWith('/dash');
    });
  });

  it('should handle login error', async () => {
    // Setup mock to reject with error
    mockLogin.mockRejectedValueOnce(new Error('Invalid credentials'));

    renderWithProviders(<NumaLogin />);

    // Fill in form
    fireEvent.change(screen.getByLabelText('Username'), {
      target: { value: 'testuser' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrongpass' },
    });

    // Submit form
    fireEvent.click(screen.getByRole('button', { name: 'Login' }));

    // Verify error message
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Invalid credentials',
      );
    });
  });

  it('should handle new password requirement', async () => {
    // Setup mocks
    mockLogin.mockResolvedValueOnce({ requiresNewPassword: true });
    mockSetNewPassword.mockResolvedValueOnce({ success: true });

    renderWithProviders(<NumaLogin />);

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
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You need to set a new password. Please enter a new password below.',
      );
    });

    // Fill in new password form
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'newpassword123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'newpassword123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

    // Verify new password was set
    await waitFor(() => {
      expect(mockSetNewPassword).toHaveBeenCalledWith(
        'testuser',
        'password123',
        'newpassword123',
      );
    });
  });

  it('should handle new password update failure', async () => {
    // Setup mocks
    mockLogin.mockResolvedValueOnce({ requiresNewPassword: true });
    mockSetNewPassword.mockRejectedValueOnce(
      new Error('Password update failed'),
    );

    renderWithProviders(<NumaLogin />);

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
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You need to set a new password. Please enter a new password below.',
      );
    });

    // Fill in new password form
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'newpassword123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'newpassword123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

    // Verify error message appears
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Password update failed',
      );
    });
  });

  it('should handle mismatched new passwords', async () => {
    // Setup mocks
    mockLogin.mockResolvedValueOnce({ requiresNewPassword: true });

    renderWithProviders(<NumaLogin />);

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
      expect(screen.getByRole('alert')).toHaveTextContent(
        'You need to set a new password. Please enter a new password below.',
      );
    });

    // Fill in new password form with mismatched passwords
    fireEvent.change(screen.getByLabelText('New Password'), {
      target: { value: 'newpassword123' },
    });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), {
      target: { value: 'differentpassword123' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Set New Password' }));

    // Verify error message appears
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "Passwords don't match",
      );
      expect(mockSetNewPassword).not.toHaveBeenCalled();
    });
  });
});
