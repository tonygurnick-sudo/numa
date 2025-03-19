/**
 * @vitest-environment jsdom
 */
import { ChatReferencesDropdown } from '../../Components/ChatReferencesDropdown';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import * as fileUtils from '../../utils/fileUtils';

// Mock the fileUtils module
vi.mock('../../utils/fileUtils', () => ({
  getContentType: vi.fn(),
}));

// Mock AWS SDK components
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({
    send: vi.fn(),
  })),
  GetObjectCommand: vi.fn(),
}));

const mockGetSignedUrl = vi.fn();
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

describe('ChatReferencesDropdown', () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.resetAllMocks();

    // Set a default mock implementation for getContentType
    fileUtils.getContentType.mockReturnValue('application/octet-stream');
  });

  test('should not render anything when no references are provided', () => {
    const { container } = render(<ChatReferencesDropdown references={[]} getIdentityPoolCredentials={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  test('should render dropdown when references are provided', async () => {
    const mockReferences = ['s3://bucket/file.txt'];

    // Mock getContentType for this specific test
    fileUtils.getContentType.mockReturnValue('text/plain');

    // Mock getIdentityPoolCredentials to return valid AWS credentials
    const mockGetIdentityPoolCredentials = vi.fn().mockResolvedValue({
      accessKeyId: 'mockAccessKeyId',
      secretAccessKey: 'mockSecretAccessKey',
      sessionToken: 'mockSessionToken',
    });

    mockGetSignedUrl.mockResolvedValue('https://mock-signed-url');

    await act(async () => {
      render(
        <ChatReferencesDropdown
          references={mockReferences}
          getIdentityPoolCredentials={mockGetIdentityPoolCredentials}
        />,
      );
    });

    // Check for the presence of the dropdown button
    const button = screen.getByText('Show References');
    expect(button).toBeTruthy();
    expect(button.tagName).toBe('BUTTON');

    // The collapse should not be visible initially
    const fileText = screen.queryByText('file.txt');
    expect(fileText).toBeTruthy();

    const collapseElement = fileText.closest('.collapse');
    expect(collapseElement).toBeTruthy();
    expect(collapseElement.classList.contains('show')).toBe(false);

    // Click the reference to trigger getPresignedUrl and thus getContentType
    await act(async () => {
      fireEvent.click(fileText);
    });

    // Verify that getContentType was called
    expect(fileUtils.getContentType).toHaveBeenCalledWith('file.txt');
  });

  test('should toggle dropdown visibility when button is clicked', async () => {
    const mockReferences = ['s3://bucket/file.txt'];
    const mockGetIdentityPoolCredentials = vi.fn().mockResolvedValue({
      accessKeyId: 'mockAccessKeyId',
      secretAccessKey: 'mockSecretAccessKey',
      sessionToken: 'mockSessionToken',
    });

    mockGetSignedUrl.mockResolvedValue('https://mock-signed-url');

    await act(async () => {
      render(
        <ChatReferencesDropdown
          references={mockReferences}
          getIdentityPoolCredentials={mockGetIdentityPoolCredentials}
        />,
      );
    });

    const button = screen.getByText('Show References');
    expect(button).toBeTruthy();

    // Click the button to show the references
    await act(async () => {
      fireEvent.click(button);
    });

    // Use waitFor to wait for the collapse element to have the 'show' class
    const collapseElement = await waitFor(() => {
      const fileText = screen.queryByText('file.txt');
      expect(fileText).toBeTruthy();
      const collapseEl = fileText.closest('.collapse');
      expect(collapseEl).toBeTruthy();
      expect(collapseEl.classList.contains('show')).toBe(true);
      return collapseEl;
    });

    // Click the button again to hide the references
    await act(async () => {
      fireEvent.click(button);
    });

    // Use waitFor to wait for the collapse element to not have the 'show' class
    await waitFor(() => {
      expect(collapseElement.classList.contains('show')).toBe(false);
    });
  });

  test('should render multiple references correctly', async () => {
    const mockReferences = ['s3://bucket/file1.txt', 's3://bucket/file2.txt'];
    const mockGetIdentityPoolCredentials = vi.fn().mockResolvedValue({
      accessKeyId: 'mockAccessKeyId',
      secretAccessKey: 'mockSecretAccessKey',
      sessionToken: 'mockSessionToken',
    });

    mockGetSignedUrl.mockResolvedValue('https://mock-signed-url');

    await act(async () => {
      render(
        <ChatReferencesDropdown
          references={mockReferences}
          getIdentityPoolCredentials={mockGetIdentityPoolCredentials}
        />,
      );
    });

    const button = screen.getByText('Show References');
    expect(button).toBeTruthy();

    // Click the button to show the references
    await act(async () => {
      fireEvent.click(button);
    });

    const file1 = screen.getByText('file1.txt');
    const file2 = screen.getByText('file2.txt');
    expect(file1).toBeTruthy();
    expect(file2).toBeTruthy();
  });

  test('should handle errors in getPresignedUrl gracefully', async () => {
    const mockReferences = ['s3://bucket/file.txt'];

    // Mock getSignedUrl to throw an error
    mockGetSignedUrl.mockRejectedValue(new Error('Failed to get presigned URL'));

    const mockGetIdentityPoolCredentials = vi.fn().mockResolvedValue({
      accessKeyId: 'mockAccessKeyId',
      secretAccessKey: 'mockSecretAccessKey',
      sessionToken: 'mockSessionToken',
    });

    await act(async () => {
      render(
        <ChatReferencesDropdown
          references={mockReferences}
          getIdentityPoolCredentials={mockGetIdentityPoolCredentials}
        />,
      );
    });

    const fileText = screen.queryByText('file.txt');
    expect(fileText).toBeTruthy();

    // Mocking console.error to capture the error log
    const consoleErrorMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Click the reference to trigger getPresignedUrl
    await act(async () => {
      fireEvent.click(fileText);
    });

    // Ensure console.error is called with the expected structure
    expect(consoleErrorMock).toHaveBeenCalledWith('Error getting presigned URL:', expect.any(Error));
    consoleErrorMock.mockRestore(); // Restore the original implementation
  });

  test('should have appropriate ARIA attributes for accessibility', async () => {
    const mockReferences = ['s3://bucket/file.txt'];
    const mockGetIdentityPoolCredentials = vi.fn().mockResolvedValue({
      accessKeyId: 'mockAccessKeyId',
      secretAccessKey: 'mockSecretAccessKey',
      sessionToken: 'mockSessionToken',
    });

    mockGetSignedUrl.mockResolvedValue('https://mock-signed-url');

    await act(async () => {
      render(
        <ChatReferencesDropdown
          references={mockReferences}
          getIdentityPoolCredentials={mockGetIdentityPoolCredentials}
        />,
      );
    });

    const button = screen.getByText('Show References');
    expect(button.getAttribute('aria-controls')).toBe('references-collapse');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    // Click the button to show the references
    await act(async () => {
      fireEvent.click(button);
    });

    expect(button.getAttribute('aria-expanded')).toBe('true');
  });
});
