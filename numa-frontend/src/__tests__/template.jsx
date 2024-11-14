/**
 * @vitest-environment jsdom
 */

// Import mocks first
import { renderWithProviders, clearAllMocks } from '../Mocks/ProviderWrapper';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';

// Import the component you're testing
import { YourComponent } from '../../Components/YourComponent';

describe('YourComponent', () => {
  beforeEach(() => {
    clearAllMocks();
  });

  // Helper function to render your component with standard providers
  const renderComponent = (props = {}) => {
    return renderWithProviders(<YourComponent {...props} />);
  };

  /**
   * Basic rendering test
   */
  it('should render initial layout correctly', () => {
    renderComponent();

    // Test basic UI elements
    expect(screen.getByTestId('your-element')).toBeInTheDocument();
  });

  /**
   * Async operation test
   */
  it('should handle async operations', async () => {
    // Mock any API calls
    const mockResponse = { data: 'test' };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    renderComponent();

    // Trigger async operation
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    // Wait for and verify results
    await waitFor(() => {
      expect(screen.getByText('Success')).toBeInTheDocument();
    });
  });

  /**
   * Error handling test
   */
  it('should handle errors appropriately', async () => {
    // Mock API failure
    global.fetch = vi.fn().mockRejectedValue(new Error('API Error'));

    renderComponent();

    // Trigger operation that will fail
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    // Verify error state
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Error occurred');
    });
  });

  /**
   * User interaction test
   */
  it('should handle user interactions correctly', () => {
    renderComponent();

    // Simulate user input
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'test input' } });

    // Verify input was handled
    expect(input).toHaveValue('test input');
  });
});
