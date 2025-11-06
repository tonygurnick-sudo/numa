/**
 * @vitest-environment jsdom
 */

import { renderWithProviders } from '../Mocks/ProviderWrapper';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import BrandingAdminPanel from '../../Components/Branding/BrandingAdminPanel';

const serviceMocks = vi.hoisted(() => ({
  mockFetchConfig: vi.fn(),
  mockFetchHistory: vi.fn(),
  mockSaveConfig: vi.fn(),
  mockRevertVersion: vi.fn(),
  sanitizeFileName: vi.fn((name: string) => name),
}));

const toastMocks = vi.hoisted(() => ({
  showToast: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  getCredentials: vi.fn(),
}));

const s3Mocks = vi.hoisted(() => ({
  uploadFileToS3: vi.fn(),
  getSignedUrlForS3Object: vi.fn(),
}));

vi.mock('../../Services/BrandingAdminService', () => ({
  BrandingAdminService: {
    fetchConfig: serviceMocks.mockFetchConfig,
    fetchHistory: serviceMocks.mockFetchHistory,
    saveConfig: serviceMocks.mockSaveConfig,
    revertVersion: serviceMocks.mockRevertVersion,
  },
  sanitizeFileName: serviceMocks.sanitizeFileName,
}));

vi.mock('../../Providers/AuthProvider', () => ({
  useAuth: () => ({
    getCredentials: authMocks.getCredentials,
  }),
}));

vi.mock('../../Providers/ToastContext', () => ({
  useToast: () => ({
    showToast: toastMocks.showToast,
  }),
}));

vi.mock('../../utils/s3Utils', () => ({
  uploadFileToS3: s3Mocks.uploadFileToS3,
  getSignedUrlForS3Object: s3Mocks.getSignedUrlForS3Object,
}));

describe('BrandingAdminPanel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sessionStorage.clear();
    sessionStorage.setItem('CLIENT_NAME', 'TestTenant');
    sessionStorage.setItem('REGION', 'us-east-1');
    sessionStorage.setItem('BRANDING_ASSETS_BUCKET', 'test-bucket');
    sessionStorage.setItem('BRANDING_ASSETS_PREFIX', 'branding');

    authMocks.getCredentials.mockResolvedValue({});
    s3Mocks.uploadFileToS3.mockResolvedValue('s3://test-bucket/path.png');
    s3Mocks.getSignedUrlForS3Object.mockResolvedValue('https://example.com/signed.png');

    serviceMocks.mockFetchConfig.mockResolvedValue({
      enabled: true,
      branding: {
        name: 'Test Tenant',
        colors: {},
        splashScreen: { title: '', description: '', showText: true },
        loginPage: { title: '', welcomeMessage: '' },
        assets: {},
      },
    });
    serviceMocks.mockFetchHistory.mockResolvedValue({ history: [] });
    serviceMocks.mockSaveConfig.mockResolvedValue(undefined);
    serviceMocks.mockRevertVersion.mockResolvedValue({
      enabled: true,
      branding: {
        name: 'Restored Tenant',
        colors: {},
        splashScreen: { title: '', description: '', showText: true },
        loginPage: { title: '', welcomeMessage: '' },
        assets: {},
      },
      history: [],
    });
    toastMocks.showToast.mockClear();
  });

  it('loads version history only when accordion is opened', async () => {
    renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    expect(serviceMocks.mockFetchHistory).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Version History'));

    await waitFor(() => {
      expect(serviceMocks.mockFetchHistory).toHaveBeenCalled();
    });
  });

  it('saves changes without creating a version from the primary button', async () => {
    renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    const nameInput = screen.getByLabelText('Brand Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Updated Brand' } });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(serviceMocks.mockSaveConfig).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          createVersion: undefined,
        }),
      );
    });
  });

  it('saves changes with createVersion flag when Save as New Version is clicked', async () => {
    renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    const nameInput = screen.getByLabelText('Brand Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Versioned Brand' } });

    const saveAsVersionButton = screen.getByRole('button', { name: /save as new version/i });
    fireEvent.click(saveAsVersionButton);

    await waitFor(() => {
      expect(serviceMocks.mockSaveConfig).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          createVersion: true,
        }),
      );
    });
  });

  it('shows success toast and reloads configuration after saving', async () => {
    renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    const nameInput = screen.getByLabelText('Brand Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Toast Success' } });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(serviceMocks.mockSaveConfig).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalledTimes(2);
    });

    expect(toastMocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'success',
        message: 'Branding settings saved successfully.',
      }),
    );
  });

  it('shows error toast when saving fails', async () => {
    serviceMocks.mockSaveConfig.mockRejectedValueOnce(new Error('save broke'));

    renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    const nameInput = screen.getByLabelText('Brand Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Toast Error' } });

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(serviceMocks.mockSaveConfig).toHaveBeenCalled();
    });

    expect(toastMocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        title: 'Save failed',
      }),
    );
  });

  it('discards changes and reloads configuration', async () => {
    renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    const nameInput = screen.getByLabelText('Brand Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Dirty Name' } });

    const discardButton = screen.getByRole('button', { name: /discard changes/i });
    fireEvent.click(discardButton);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled();
    });
  });

  it('shows warning toast when asset fails validation', async () => {
    const { container } = renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    const fileInput = container.querySelector('input[type="file"][accept]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error('File input not found');
    }

    const invalidFile = new File([''], 'invalid.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, {
      target: {
        files: [invalidFile],
      },
    });

    await waitFor(() => {
      expect(s3Mocks.uploadFileToS3).not.toHaveBeenCalled();
    });

    expect(toastMocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'warning',
        title: 'Upload blocked',
        message: expect.stringContaining('Navigation Logo'),
      }),
    );
  });

  it('uploads asset successfully and shows success toast', async () => {
    const { container } = renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    const fileInput = container.querySelector('input[type="file"][accept]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error('File input not found');
    }

    const validFile = new File(['image'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(validFile, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });

    fireEvent.change(fileInput, {
      target: {
        files: [validFile],
      },
    });

    await waitFor(() => {
      expect(toastMocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'success',
          title: 'Navigation Logo',
        }),
      );
    });

    expect(s3Mocks.uploadFileToS3).toHaveBeenCalledTimes(1);
  });

  it('shows error toast when asset upload fails', async () => {
    s3Mocks.uploadFileToS3.mockRejectedValueOnce(new Error('upload fail'));

    const { container } = renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    const fileInput = container.querySelector('input[type="file"][accept]') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();
    if (!fileInput) {
      throw new Error('File input not found');
    }

    const validFile = new File(['image'], 'logo.png', { type: 'image/png' });
    Object.defineProperty(validFile, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    });

    fireEvent.change(fileInput, {
      target: {
        files: [validFile],
      },
    });

    await waitFor(() => {
      expect(toastMocks.showToast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          title: 'Navigation Logo',
        }),
      );
    });

    expect(s3Mocks.uploadFileToS3).toHaveBeenCalledTimes(1);
  });

  it('reverts a selected history entry and shows success toast', async () => {
    serviceMocks.mockFetchHistory.mockResolvedValue({
      history: [
        {
          versionId: 'ver-123',
          label: 'Release Candidate',
          updatedAt: '2025-10-22T00:00:00.000Z',
          updatedBy: 'tester',
        },
      ],
    });

    renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('Version History'));

    const revertButton = await screen.findByRole('button', { name: /revert/i });
    fireEvent.click(revertButton);

    await waitFor(() => {
      expect(serviceMocks.mockRevertVersion).toHaveBeenCalledWith(expect.any(Function), 'ver-123');
    });

    expect(toastMocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'success',
      }),
    );
  });

  it('shows an error toast when history fetch fails', async () => {
    serviceMocks.mockFetchHistory.mockRejectedValueOnce(new Error('boom'));

    renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByText('Version History'));

    await waitFor(() => {
      expect(serviceMocks.mockFetchHistory).toHaveBeenCalled();
    });

    expect(toastMocks.showToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
      }),
    );
  });
});
