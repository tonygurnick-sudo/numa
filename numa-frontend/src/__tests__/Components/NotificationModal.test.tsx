/**
 * @vitest-environment jsdom
 */
import { renderWithProviders, clearAllMocks } from '../Mocks/ProviderWrapper';

import { screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

import { NotificationModal } from '../../Components/NotificationModal';

describe('NotificationModal Component', () => {
  const defaultProps = {
    type: 'warning' as const,
    title: 'Test Title',
    message: 'Test message',
    show: true,
    onHide: vi.fn(),
  };

  beforeEach(() => {
    clearAllMocks();
    vi.clearAllMocks();
  });

  const renderNotificationModal = (props = {}) => {
    return renderWithProviders(<NotificationModal {...defaultProps} {...props} />);
  };

  describe('Basic Rendering', () => {
    it('should render modal when show is true', () => {
      renderNotificationModal();

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Test Title')).toBeInTheDocument();
      expect(screen.getByText('Test message')).toBeInTheDocument();
    });

    it('should not render modal when show is false', () => {
      renderNotificationModal({ show: false });

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('should render with custom title and message', () => {
      renderNotificationModal({
        title: 'Custom Title',
        message: 'Custom message content',
      });

      expect(screen.getByText('Custom Title')).toBeInTheDocument();
      expect(screen.getByText('Custom message content')).toBeInTheDocument();
    });

    it('should render message as ReactNode', () => {
      const messageNode = (
        <div>
          <strong>Bold text</strong>
          <p>Paragraph text</p>
        </div>
      );

      renderNotificationModal({ message: messageNode });

      expect(screen.getByText('Bold text')).toBeInTheDocument();
      expect(screen.getByText('Paragraph text')).toBeInTheDocument();
    });
  });

  describe('Notification Types and Styling', () => {
    it('should render warning type with correct styling and icon', () => {
      renderNotificationModal({ type: 'warning' });

      // Check for warning icons
      const icons = document.querySelectorAll('.bi-exclamation-triangle-fill');
      expect(icons).toHaveLength(2); // One in header, one in body

      // Check for warning styling classes
      expect(document.querySelector('.bg-warning')).toBeInTheDocument();
      expect(document.querySelector('.border-warning')).toBeInTheDocument();
      expect(document.querySelector('.text-warning')).toBeInTheDocument();

      // Check button variant
      const confirmButton = screen.getByRole('button', { name: 'OK' });
      expect(confirmButton).toHaveClass('btn-warning');
    });

    it('should render error type with correct styling and icon', () => {
      renderNotificationModal({ type: 'error' });

      // Check for error icons
      const icons = document.querySelectorAll('.bi-x-circle-fill');
      expect(icons).toHaveLength(2); // One in header, one in body

      // Check for error styling classes
      expect(document.querySelector('.bg-danger')).toBeInTheDocument();
      expect(document.querySelector('.border-danger')).toBeInTheDocument();
      expect(document.querySelector('.text-danger')).toBeInTheDocument();

      // Check button variant
      const confirmButton = screen.getByRole('button', { name: 'OK' });
      expect(confirmButton).toHaveClass('btn-danger');
    });

    it('should render success type with correct styling and icon', () => {
      renderNotificationModal({ type: 'success' });

      // Check for success icons
      const icons = document.querySelectorAll('.bi-check-circle-fill');
      expect(icons).toHaveLength(2); // One in header, one in body

      // Check for success styling classes
      expect(document.querySelector('.bg-success')).toBeInTheDocument();
      expect(document.querySelector('.border-success')).toBeInTheDocument();
      expect(document.querySelector('.text-success')).toBeInTheDocument();

      // Check button variant
      const confirmButton = screen.getByRole('button', { name: 'OK' });
      expect(confirmButton).toHaveClass('btn-success');
    });
  });

  describe('Event Handlers', () => {
    it('should call onHide when close button is clicked', () => {
      const onHideMock = vi.fn();
      renderNotificationModal({ onHide: onHideMock });

      const closeButton = screen.getByRole('button', { name: 'Close' });
      fireEvent.click(closeButton);

      expect(onHideMock).toHaveBeenCalledTimes(1);
    });

    it('should call onHide when confirm button is clicked without onConfirm', () => {
      const onHideMock = vi.fn();
      renderNotificationModal({ onHide: onHideMock });

      const confirmButton = screen.getByRole('button', { name: 'OK' });
      fireEvent.click(confirmButton);

      expect(onHideMock).toHaveBeenCalledTimes(1);
    });

    it('should call onConfirm when confirm button is clicked with onConfirm provided', () => {
      const onHideMock = vi.fn();
      const onConfirmMock = vi.fn();
      renderNotificationModal({
        onHide: onHideMock,
        onConfirm: onConfirmMock,
      });

      const confirmButton = screen.getByRole('button', { name: 'OK' });
      fireEvent.click(confirmButton);

      expect(onConfirmMock).toHaveBeenCalledTimes(1);
      expect(onHideMock).not.toHaveBeenCalled();
    });

    it('should call onHide when cancel button is clicked', () => {
      const onHideMock = vi.fn();
      renderNotificationModal({
        onHide: onHideMock,
        showCancelButton: true,
      });

      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelButton);

      expect(onHideMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Button Configuration', () => {
    it('should show only confirm button by default', () => {
      renderNotificationModal();

      expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });

    it('should show cancel button when showCancelButton is true', () => {
      renderNotificationModal({ showCancelButton: true });

      expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('should use custom button texts', () => {
      renderNotificationModal({
        showCancelButton: true,
        confirmText: 'Yes, Delete',
        cancelText: 'No, Keep',
      });

      expect(screen.getByRole('button', { name: 'Yes, Delete' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'No, Keep' })).toBeInTheDocument();
    });

    it('should apply correct button classes', () => {
      renderNotificationModal({ showCancelButton: true });

      const confirmButton = screen.getByRole('button', { name: 'OK' });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });

      expect(confirmButton).toHaveClass('btn-warning'); // Based on default warning type
      expect(cancelButton).toHaveClass('btn-secondary');
    });
  });

  describe('Modal Size Configuration', () => {
    it('should use default size lg', () => {
      renderNotificationModal();

      const modal = document.querySelector('.modal-dialog');
      expect(modal).toHaveClass('modal-lg');
    });

    it('should use custom size when provided', () => {
      renderNotificationModal({ size: 'sm' });

      const modal = document.querySelector('.modal-dialog');
      expect(modal).toHaveClass('modal-sm');
    });

    it('should use xl size when provided', () => {
      renderNotificationModal({ size: 'xl' });

      const modal = document.querySelector('.modal-dialog');
      expect(modal).toHaveClass('modal-xl');
    });
  });

  describe('Default Props', () => {
    it('should use default confirmText', () => {
      renderNotificationModal();

      expect(screen.getByRole('button', { name: 'OK' })).toBeInTheDocument();
    });

    it('should use default cancelText', () => {
      renderNotificationModal({ showCancelButton: true });

      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('should use default size', () => {
      renderNotificationModal();

      const modal = document.querySelector('.modal-dialog');
      expect(modal).toHaveClass('modal-lg');
    });

    it('should not show cancel button by default', () => {
      renderNotificationModal();

      expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    });
  });

  describe('Modal Structure and Layout', () => {
    it('should have proper modal structure', () => {
      renderNotificationModal();

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(document.querySelector('.modal-header')).toBeInTheDocument();
      expect(document.querySelector('.modal-body')).toBeInTheDocument();
      expect(document.querySelector('.modal-footer')).toBeInTheDocument();
    });

    it('should center the modal', () => {
      renderNotificationModal();

      const modal = document.querySelector('.modal-dialog');
      expect(modal).toHaveClass('modal-dialog-centered');
    });

    it('should have close button in header', () => {
      renderNotificationModal();

      const headerCloseButton = document.querySelector('.modal-header .btn-close');
      expect(headerCloseButton).toBeInTheDocument();
    });

    it('should display icons in both header and body', () => {
      renderNotificationModal({ type: 'warning' });

      // Header icon
      const headerIcon = document.querySelector('.modal-title .bi-exclamation-triangle-fill');
      expect(headerIcon).toBeInTheDocument();

      // Body icon
      const bodyIcon = document.querySelector('.modal-body .bi-exclamation-triangle-fill');
      expect(bodyIcon).toBeInTheDocument();
    });

    it('should have left-aligned footer buttons', () => {
      renderNotificationModal();

      const footer = document.querySelector('.modal-footer');
      expect(footer).toHaveClass('d-flex', 'justify-content-start');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      renderNotificationModal();

      const modal = screen.getByRole('dialog');
      expect(modal).toBeInTheDocument();
    });

    it('should have proper button roles', () => {
      renderNotificationModal({ showCancelButton: true });

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(3); // Close, Cancel, Confirm
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message string', () => {
      renderNotificationModal({ message: '' });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // Message paragraph should still exist but be empty
      const messageElement = document.querySelector('.modal-body p');
      expect(messageElement).toBeInTheDocument();
      expect(messageElement?.textContent).toBe('');
    });

    it('should handle very long title', () => {
      const longTitle =
        'This is a very long title that might wrap to multiple lines and test how the modal handles extensive text content';
      renderNotificationModal({ title: longTitle });

      expect(screen.getByText(longTitle)).toBeInTheDocument();
    });

    it('should handle very long message', () => {
      const longMessage =
        'This is a very long message that should test how the modal handles extensive content that might span multiple lines and potentially affect the layout of the modal component.';
      renderNotificationModal({ message: longMessage });

      expect(screen.getByText(longMessage)).toBeInTheDocument();
    });

    it('should handle multiple rapid clicks on confirm button', () => {
      const onConfirmMock = vi.fn();
      renderNotificationModal({ onConfirm: onConfirmMock });

      const confirmButton = screen.getByRole('button', { name: 'OK' });

      // Rapid clicks
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);
      fireEvent.click(confirmButton);

      expect(onConfirmMock).toHaveBeenCalledTimes(3);
    });
  });

  describe('Component Integration', () => {
    it('should work with all props combinations', () => {
      renderNotificationModal({
        type: 'success',
        title: 'Success Title',
        message: 'Success message',
        show: true,
        onHide: vi.fn(),
        onConfirm: vi.fn(),
        confirmText: 'Great!',
        cancelText: 'Maybe Later',
        size: 'xl',
        showCancelButton: true,
      });

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Success Title')).toBeInTheDocument();
      expect(screen.getByText('Success message')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Great!' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Maybe Later' })).toBeInTheDocument();

      const modal = document.querySelector('.modal-dialog');
      expect(modal).toHaveClass('modal-xl');
    });
  });
});
