/**
 * @vitest-environment jsdom
 */
import { setupAuthMocks } from '../Mocks/AuthMockHandlers';
import { clearAllMocks, renderWithProviders } from '../Mocks/ProviderWrapper';

import { screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { ResetPassword } from '../../Pages/ResetPassword';

describe('ResetPassword Component', () => {
  // Get the auth handlers from setupAuthMocks
  const authHandlers = setupAuthMocks();

  beforeEach(() => {
    clearAllMocks();
  });

  it('should render initial password reset request form', () => {
    renderWithProviders(<ResetPassword />);

    expect(screen.getByRole('heading', { name: 'Password Reset' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your email')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request Password Reset' })).toBeInTheDocument();
  });

  it('should handle password reset request submission', async () => {
    authHandlers.requestPasswordReset.mockResolvedValueOnce();

    renderWithProviders(<ResetPassword />);

    const emailInput = screen.getByPlaceholderText('Enter your email');
    const submitButton = screen.getByRole('button', {
      name: 'Request Password Reset',
    });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Password reset code sent. Please check your email.')).toBeInTheDocument();
    });
    expect(authHandlers.requestPasswordReset).toHaveBeenCalledWith('test@example.com');
  });

  it('should handle password reset request error', async () => {
    authHandlers.requestPasswordReset.mockRejectedValueOnce(new Error('Invalid email'));

    renderWithProviders(<ResetPassword />);

    const emailInput = screen.getByPlaceholderText('Enter your email');
    const submitButton = screen.getByRole('button', {
      name: 'Request Password Reset',
    });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Invalid email')).toBeInTheDocument();
    });
  });

  it('should render password reset form after code is sent', async () => {
    authHandlers.requestPasswordReset.mockResolvedValueOnce();

    renderWithProviders(<ResetPassword />);

    // Submit the initial form
    const emailInput = screen.getByPlaceholderText('Enter your email');
    const submitButton = screen.getByRole('button', {
      name: 'Request Password Reset',
    });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter the code')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter your new password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Confirm your new password')).toBeInTheDocument();
    });
  });

  it('should handle password reset confirmation', async () => {
    authHandlers.requestPasswordReset.mockResolvedValueOnce();
    authHandlers.confirmPasswordReset.mockResolvedValueOnce();

    renderWithProviders(<ResetPassword />);

    // Submit the initial form
    const emailInput = screen.getByPlaceholderText('Enter your email');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Request Password Reset' }));

    // Wait for the reset form to appear
    await waitFor(() => {
      expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
    });

    // Fill out the reset form
    const codeInput = screen.getByPlaceholderText('Enter the code');
    const newPasswordInput = screen.getByPlaceholderText('Enter your new password');
    const confirmPasswordInput = screen.getByPlaceholderText('Confirm your new password');
    const resetEmailInput = screen.getByPlaceholderText('Enter your email');

    // Fill in all form fields
    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.change(resetEmailInput, {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(newPasswordInput, { target: { value: 'newpassword' } });
    fireEvent.change(confirmPasswordInput, {
      target: { value: 'newpassword' },
    });

    // Submit the reset form
    const resetButton = screen.getByRole('button', { name: 'Reset Password' });
    fireEvent.click(resetButton);

    // Wait for the confirmation handler to be called
    await waitFor(() => {
      expect(authHandlers.confirmPasswordReset).toHaveBeenCalledWith('test@example.com', '123456', 'newpassword');
    });

    // Update the expected success message to match the actual UI
    expect(screen.getByText('Password reset successfully. Redirecting to login...')).toBeInTheDocument();
  });

  it('should handle password mismatch', async () => {
    authHandlers.requestPasswordReset.mockResolvedValueOnce();

    renderWithProviders(<ResetPassword />);

    // Get to the reset form
    fireEvent.change(screen.getByPlaceholderText('Enter your email'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Request Password Reset' }));

    await waitFor(() => {
      expect(screen.getByText('Reset Your Password')).toBeInTheDocument();
    });

    // Fill form with mismatched passwords
    const codeInput = screen.getByPlaceholderText('Enter the code');
    const emailInput = screen.getByPlaceholderText('Enter your email');
    const newPasswordInput = screen.getByPlaceholderText('Enter your new password');
    const confirmPasswordInput = screen.getByPlaceholderText('Confirm your new password');

    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(newPasswordInput, { target: { value: 'password1' } });
    fireEvent.change(confirmPasswordInput, { target: { value: 'password2' } });

    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: 'Reset Password' }));

    // Look for the correct error message in an alert
    expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');

    expect(authHandlers.confirmPasswordReset).not.toHaveBeenCalled();
  });
});
