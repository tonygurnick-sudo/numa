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

// Mock the required hooks and dependencies
vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}));

vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <div data-testid="mfa-qr-code-svg" data-value={value} />,
}));

const mockedUseNavigate = useNavigate as unknown as Mock;
const mockedUseAuth = useAuth as unknown as Mock;

describe('NumaLogin Component', () => {
  const mockNavigate = vi.fn();
  const mockLogin = vi.fn();
  const mockSetNewPassword = vi.fn();
  const mockCompleteMfaSetup = vi.fn();
  const mockSubmitMfaCode = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockedUseNavigate.mockReturnValue(mockNavigate);
    mockedUseAuth.mockReturnValue({
      login: mockLogin,
      setNewPassword: mockSetNewPassword,
      completeMfaSetup: mockCompleteMfaSetup,
      submitMfaCode: mockSubmitMfaCode,
    });
  });

  it('renders login form correctly', () => {
    const { getByLabelText, getByText, getByRole } = render(<NumaLogin />);

    expect(getByLabelText('Username')).toBeInTheDocument();
    expect(getByLabelText('Password')).toBeInTheDocument();
    expect(getByRole('button', { name: 'Login' })).toBeInTheDocument();
    expect(getByText('Forgot password')).toBeInTheDocument();
  });

  it('handles successful login and navigates to /dash when no chat feature', async () => {
    mockLogin.mockResolvedValueOnce({ success: true, features: [] });

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

  it('handles successful login and navigates to /chat when chat feature is enabled', async () => {
    mockLogin.mockResolvedValueOnce({ success: true, features: ['chat'] });

    const { getByLabelText, getByRole } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/chat');
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
    mockSetNewPassword.mockResolvedValueOnce({ success: true, features: [] });

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

  // --- MFA Setup Tests (first-time enrollment) ---

  it('shows MFA setup form when login returns requiresMfaSetup', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfaSetup: true,
      session: 'mock-session',
      username: 'testuser',
      secretCode: 'ABCDEFGHIJKLMNOP',
      otpauthUrl: 'otpauth://totp/Numa:testuser?secret=ABCDEFGHIJKLMNOP&issuer=Numa',
    });

    const { getByLabelText, getByRole, getByTestId, findByText } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    // Should display the QR code
    await waitFor(() => {
      expect(getByTestId('mfa-qr-code')).toBeInTheDocument();
    });

    // Should display the secret key for manual entry
    expect(getByTestId('mfa-secret-key')).toHaveValue('ABCDEFGHIJKLMNOP');

    // Should display the setup instructions
    expect(await findByText('Set Up Two-Factor Authentication')).toBeInTheDocument();

    // Should have the code input and verify button
    expect(getByTestId('mfa-code-input')).toBeInTheDocument();
    expect(getByTestId('mfa-setup-button')).toBeInTheDocument();
  });

  it('completes MFA setup and navigates to /dash when no chat feature', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfaSetup: true,
      session: 'mock-session',
      username: 'testuser',
      secretCode: 'ABCDEFGHIJKLMNOP',
      otpauthUrl: 'otpauth://totp/Numa:testuser?secret=ABCDEFGHIJKLMNOP&issuer=Numa',
    });
    mockCompleteMfaSetup.mockResolvedValueOnce({ success: true, features: [] });

    const { getByLabelText, getByRole, getByTestId } = render(<NumaLogin />);

    // Login first
    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    // Wait for MFA setup form, then enter code
    await waitFor(() => {
      expect(getByTestId('mfa-code-input')).toBeInTheDocument();
    });

    fireEvent.change(getByTestId('mfa-code-input'), { target: { value: '123456' } });
    fireEvent.click(getByTestId('mfa-setup-button'));

    await waitFor(() => {
      expect(mockCompleteMfaSetup).toHaveBeenCalledWith('123456', false);
      expect(mockNavigate).toHaveBeenCalledWith('/dash');
    });
  });

  it('shows error for invalid MFA setup code (too short)', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfaSetup: true,
      session: 'mock-session',
      username: 'testuser',
      secretCode: 'ABCDEFGHIJKLMNOP',
      otpauthUrl: 'otpauth://totp/Numa:testuser?secret=ABCDEFGHIJKLMNOP&issuer=Numa',
    });

    const { getByLabelText, getByRole, getByTestId, findByText } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(getByTestId('mfa-code-input')).toBeInTheDocument();
    });

    // Submit with too-short code
    fireEvent.change(getByTestId('mfa-code-input'), { target: { value: '123' } });
    fireEvent.click(getByTestId('mfa-setup-button'));

    await waitFor(async () => {
      expect(await findByText('Invalid verification code. Please enter a 6-digit code.')).toBeInTheDocument();
      expect(mockCompleteMfaSetup).not.toHaveBeenCalled();
    });
  });

  it('shows error when MFA setup fails', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfaSetup: true,
      session: 'mock-session',
      username: 'testuser',
      secretCode: 'ABCDEFGHIJKLMNOP',
      otpauthUrl: 'otpauth://totp/Numa:testuser?secret=ABCDEFGHIJKLMNOP&issuer=Numa',
    });
    mockCompleteMfaSetup.mockRejectedValueOnce(new Error('Invalid verification code'));

    const { getByLabelText, getByRole, getByTestId, findByText } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(getByTestId('mfa-code-input')).toBeInTheDocument();
    });

    fireEvent.change(getByTestId('mfa-code-input'), { target: { value: '000000' } });
    fireEvent.click(getByTestId('mfa-setup-button'));

    await waitFor(async () => {
      expect(await findByText('Invalid verification code')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });

  // --- MFA Code Tests (subsequent logins) ---

  it('shows MFA code form when login returns requiresMfaCode', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfaCode: true,
      session: 'mock-session',
      username: 'testuser',
    });

    const { getByLabelText, getByRole, getByTestId, findByText } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    // Should display the code entry form
    await waitFor(async () => {
      expect(await findByText('Two-Factor Authentication')).toBeInTheDocument();
      expect(getByTestId('mfa-code-input')).toBeInTheDocument();
      expect(getByTestId('mfa-verify-button')).toBeInTheDocument();
    });

    // Should show "contact admin" message instead of self-reset
    expect(await findByText(/Contact your administrator/)).toBeInTheDocument();
  });

  it('submits MFA code and navigates to /dash when no chat feature', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfaCode: true,
      session: 'mock-session',
      username: 'testuser',
    });
    mockSubmitMfaCode.mockResolvedValueOnce({ success: true, features: [] });

    const { getByLabelText, getByRole, getByTestId } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(getByTestId('mfa-code-input')).toBeInTheDocument();
    });

    fireEvent.change(getByTestId('mfa-code-input'), { target: { value: '654321' } });
    fireEvent.click(getByTestId('mfa-verify-button'));

    await waitFor(() => {
      expect(mockSubmitMfaCode).toHaveBeenCalledWith('654321', false);
      expect(mockNavigate).toHaveBeenCalledWith('/dash');
    });
  });

  it('shows error for invalid MFA code (too short)', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfaCode: true,
      session: 'mock-session',
      username: 'testuser',
    });

    const { getByLabelText, getByRole, getByTestId, findByText } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(getByTestId('mfa-code-input')).toBeInTheDocument();
    });

    fireEvent.change(getByTestId('mfa-code-input'), { target: { value: '12' } });
    fireEvent.click(getByTestId('mfa-verify-button'));

    await waitFor(async () => {
      expect(await findByText('Invalid verification code. Please enter a 6-digit code.')).toBeInTheDocument();
      expect(mockSubmitMfaCode).not.toHaveBeenCalled();
    });
  });

  it('shows error when MFA code verification fails', async () => {
    mockLogin.mockResolvedValueOnce({
      requiresMfaCode: true,
      session: 'mock-session',
      username: 'testuser',
    });
    mockSubmitMfaCode.mockRejectedValueOnce(new Error('Code expired'));

    const { getByLabelText, getByRole, getByTestId, findByText } = render(<NumaLogin />);

    fireEvent.change(getByLabelText('Username'), { target: { value: 'testuser' } });
    fireEvent.change(getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(getByRole('button', { name: 'Login' }));

    await waitFor(() => {
      expect(getByTestId('mfa-code-input')).toBeInTheDocument();
    });

    fireEvent.change(getByTestId('mfa-code-input'), { target: { value: '999999' } });
    fireEvent.click(getByTestId('mfa-verify-button'));

    await waitFor(async () => {
      expect(await findByText('Code expired')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
