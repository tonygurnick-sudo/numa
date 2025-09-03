/**
 * @vitest-environment jsdom
 */
import { setupAuthMocks } from '../Mocks/AuthMockHandlers';
import { clearAllMocks, renderWithProviders } from '../Mocks/ProviderWrapper';
import { setupNavigationMocks } from '../Mocks/NavigationMockHandlers';

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

  describe('Password Reset Flow', () => {
    beforeEach(() => {
      // Set up navigation for reset password path
      setupNavigationMocks({
        pathname: '/reset-password',
        search: '',
        hash: '',
      });
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
      expect(authHandlers.requestPasswordReset).toHaveBeenCalledWith('test@example.com', 'reset');
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
        expect(screen.getByText('Password Reset')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Enter the code')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Enter your new password')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Confirm your new password')).toBeInTheDocument();
      });
    });

    it('should advance to reset form when code and email are in URL parameters', () => {
      // Set up navigation with code and email in URL parameters
      setupNavigationMocks({
        pathname: '/reset-password',
        search: '?email=test@example.com&code=123456',
        hash: '',
      });

      renderWithProviders(<ResetPassword />);

      // It should directly show the reset password form
      expect(screen.getByText('Password Reset')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Enter the code')).toHaveValue('123456');
      expect(screen.getByPlaceholderText('Enter your email')).toHaveValue('test@example.com');
      expect(screen.getByPlaceholderText('Enter your new password')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Confirm your new password')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reset Password' })).toBeInTheDocument();
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
        expect(screen.getByText('Password Reset')).toBeInTheDocument();
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
        expect(screen.getByText('Password Reset')).toBeInTheDocument();
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

      expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
      expect(authHandlers.confirmPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('Create Password Flow', () => {
    beforeEach(() => {
      // Set up navigation for create password path with email in query
      setupNavigationMocks({
        pathname: '/create-password',
        search: '?email=test@example.com&code=123456',
        hash: '',
      });
    });

    it('should render at correct step when a link has email and code in the query', () => {
      renderWithProviders(<ResetPassword />);

      expect(screen.getByText('Create Your Password')).toBeInTheDocument();

      // Check that the email and code are in the form
      expect(screen.getByPlaceholderText('Enter your email')).toHaveValue('test@example.com');
      expect(screen.getByPlaceholderText('Enter the code')).toHaveValue('123456');
    });

    it('should handle activation code request submission', async () => {
      authHandlers.requestPasswordReset.mockResolvedValueOnce();

      // Reset navigation mock without code and email in URL for this specific test
      setupNavigationMocks({
        pathname: '/create-password',
        search: '',
        hash: '',
      });

      renderWithProviders(<ResetPassword />);

      const emailInput = screen.getByPlaceholderText('Enter your email');
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      const submitButton = screen.getByRole('button', { name: 'Request Activation Code' });
      fireEvent.click(submitButton);

      await waitFor(() => {
        expect(screen.getByText('Activation code sent. Please check your email.')).toBeInTheDocument();
      });
      expect(authHandlers.requestPasswordReset).toHaveBeenCalledWith('test@example.com', 'create');
    });

    it('should render create password form after code is sent', async () => {
      authHandlers.requestPasswordReset.mockResolvedValueOnce();

      // Reset navigation mock without code and email in URL for this specific test
      setupNavigationMocks({
        pathname: '/create-password',
        search: '',
        hash: '',
      });

      renderWithProviders(<ResetPassword />);

      // Fill email field first
      const emailInput = screen.getByPlaceholderText('Enter your email');
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } });

      // Request the activation code
      fireEvent.click(screen.getByRole('button', { name: 'Request Activation Code' }));

      await waitFor(() => {
        expect(screen.getByText('Create Your Password')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Enter the code')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Enter your new password')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Confirm your new password')).toBeInTheDocument();
      });
    });

    it('should handle password creation confirmation', async () => {
      authHandlers.requestPasswordReset.mockResolvedValueOnce();
      authHandlers.confirmPasswordReset.mockResolvedValueOnce();

      renderWithProviders(<ResetPassword />);

      // The form is already in the second step due to URL parameters

      // Fill out the form
      fireEvent.change(screen.getByPlaceholderText('Enter your new password'), { target: { value: 'newpassword' } });
      fireEvent.change(screen.getByPlaceholderText('Confirm your new password'), { target: { value: 'newpassword' } });

      // Submit the form
      fireEvent.click(screen.getByRole('button', { name: 'Create Password' }));

      await waitFor(() => {
        expect(authHandlers.confirmPasswordReset).toHaveBeenCalledWith('test@example.com', '123456', 'newpassword');
      });

      expect(screen.getByText('Password created successfully. Redirecting to login...')).toBeInTheDocument();
    });

    it('should handle password mismatch in create mode', async () => {
      renderWithProviders(<ResetPassword />);

      // The form is already in the second step due to URL parameters

      // Fill form with mismatched passwords
      fireEvent.change(screen.getByPlaceholderText('Enter your new password'), { target: { value: 'password1' } });
      fireEvent.change(screen.getByPlaceholderText('Confirm your new password'), { target: { value: 'password2' } });

      // Submit the form
      fireEvent.click(screen.getByRole('button', { name: 'Create Password' }));

      expect(screen.getByRole('alert')).toHaveTextContent('Passwords do not match.');
      expect(authHandlers.confirmPasswordReset).not.toHaveBeenCalled();
    });
  });
});
