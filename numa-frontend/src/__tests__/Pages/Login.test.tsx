/**
 * @vitest-environment jsdom
 */
import { render, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import '@testing-library/jest-dom';
import { NumaLogin } from '../../Pages/Login';
import { useAuth } from '../../Providers/AuthProvider';
import { useNavigate } from 'react-router-dom';

// Mock the required hooks
vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}));

vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

const mockedUseNavigate = useNavigate as unknown as Mock;
const mockedUseAuth = useAuth as unknown as Mock;

describe('NumaLogin Component', () => {
  const mockNavigate = vi.fn();
  const mockLogin = vi.fn();
  const mockSetNewPassword = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockedUseNavigate.mockReturnValue(mockNavigate);
    mockedUseAuth.mockReturnValue({
      login: mockLogin,
      setNewPassword: mockSetNewPassword,
    });
  });

  it('renders login form correctly', () => {
    const { getByLabelText, getByText, getByRole } = render(<NumaLogin />);

    expect(getByLabelText('Username')).toBeInTheDocument();
    expect(getByLabelText('Password')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Login' })).toBeInTheDocument();
    expect(getByText('Forgot password')).toBeInTheDocument();
  });

  it('handles successful login', async () => {
    mockLogin.mockResolvedValueOnce({ requiresNewPassword: false });

    const { getByLabelText, getByRole } = render(<NumaLogin />);

    const usernameInput = getByLabelText('Username');
    const passwordInput = getByLabelText('Password');
    const submitButton = getByRole('button', { name: 'Login' });

    fireEvent.change(usernameInput, { target: { value: 'testuser' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123');
      expect(mockNavigate).toHaveBeenCalledWith('/dash');
    });
  });

  it('handles login with required password change', async () => {
    mockLogin.mockResolvedValueOnce({ requiresNewPassword: true });

    const { getByLabelText, getByRole, findByLabelText } = render(<NumaLogin />);

    const usernameInput = getByLabelText('Username');
    const passwordInput = getByLabelText('Password');
    const submitButton = getByRole('button', { name: 'Login' });

    fireEvent.change(usernameInput, { target: { value: 'testuser' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(submitButton);

    await waitFor(async () => {
      expect(mockLogin).toHaveBeenCalledWith('testuser', 'password123');
      expect(await findByLabelText('New Password')).toBeInTheDocument();
      expect(await findByLabelText('Confirm New Password')).toBeInTheDocument();
    });
  });

  it('handles new password submission', async () => {
    mockLogin.mockResolvedValueOnce({ requiresNewPassword: true });
    mockSetNewPassword.mockResolvedValueOnce({});

    const { getByLabelText, getByText, getByRole, findByLabelText } = render(<NumaLogin />);

    // First login attempt
    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'oldpass' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    // New password form
    await waitFor(async () => {
      const newPasswordInput = await findByLabelText('New Password');
      const confirmPasswordInput = await findByLabelText('Confirm New Password');

      fireEvent.change(newPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.click(getByText('Set New Password'));
    });

    await waitFor(() => {
      expect(mockSetNewPassword).toHaveBeenCalledWith('testuser', 'oldpass', 'newpass123');
      expect(mockNavigate).toHaveBeenCalledWith('/dash');
    });
  });

  it('shows error for mismatched passwords', async () => {
    mockLogin.mockResolvedValueOnce({ requiresNewPassword: true });

    const { getByLabelText, getByText, getByRole, findByLabelText, findByText } = render(<NumaLogin />);

    // First login attempt
    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'oldpass' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    // New password form with mismatched passwords
    await waitFor(async () => {
      const newPasswordInput = await findByLabelText('New Password');
      const confirmPasswordInput = await findByLabelText('Confirm New Password');

      fireEvent.change(newPasswordInput, { target: { value: 'newpass123' } });
      fireEvent.change(confirmPasswordInput, { target: { value: 'different123' } });
      fireEvent.click(getByText('Set New Password'));
    });

    await waitFor(async () => {
      expect(await findByText("Passwords don't match")).toBeInTheDocument();
      expect(mockSetNewPassword).not.toHaveBeenCalled();
    });
  });

  it('handles login errors', async () => {
    const errorMessage = 'Invalid credentials';
    mockLogin.mockRejectedValueOnce(new Error(errorMessage));

    const { getByLabelText, getByRole, findByText } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'wrongpass' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    await waitFor(async () => {
      expect(await findByText(errorMessage)).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  it('validates required fields', async () => {
    const { getByRole, findByText } = render(<NumaLogin />);

    fireEvent.click(getByRole('button', { name: 'Login' }));

    await waitFor(async () => {
      expect(await findByText('Username and password are required')).toBeInTheDocument();
      expect(mockLogin).not.toHaveBeenCalled();
    });
  });

  it('validates no spaces in credentials', async () => {
    const { getByLabelText, getByRole, findByText } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'test user' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'pass word' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    await waitFor(async () => {
      expect(await findByText('Username and password cannot contain spaces')).toBeInTheDocument();
      expect(mockLogin).not.toHaveBeenCalled();
    });
  });
});
