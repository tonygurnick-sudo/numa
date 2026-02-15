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
  resolveS3Location: (uri: string) => {
    if (!uri) return null;
    if (uri.startsWith('s3://')) {
      const withoutScheme = uri.slice(5);
      const slashIndex = withoutScheme.indexOf('/');
      if (slashIndex === -1) return null;
      return { bucket: withoutScheme.slice(0, slashIndex), key: withoutScheme.slice(slashIndex + 1) };
    }
    // Handle HTTPS S3 URLs
    try {
      const url = new URL(uri);
      if (url.hostname.includes('.s3.')) {
        const bucket = url.hostname.split('.s3.')[0];
        const key = url.pathname.slice(1);
        return { bucket, key };
      }
    } catch {
      return null;
    }
    return null;
  },
  buildS3HttpsUrl: (bucket: string, key: string, region: string) => {
    if (!bucket || !key) return undefined;
    return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
  },
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

    const nameInput = (await screen.findByLabelText('Brand Name')) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Updated Brand' } });

    // Find the Save Changes button that is NOT disabled (the one that becomes enabled after making changes)
    const saveButtons = screen.getAllByRole('button', { name: /save changes/i });
    const saveButton = saveButtons.find((btn) => !btn.hasAttribute('disabled'));
    expect(saveButton).toBeDefined();
    fireEvent.click(saveButton!);

    await waitFor(() => {
      expect(serviceMocks.mockSaveConfig).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          createVersion: undefined,
        }),
      );
    });
  });

  it('saves changes with createVersion flag when Save as New Version is clicked and confirmed in modal', async () => {
    renderWithProviders(<BrandingAdminPanel />);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalled();
    });

    const nameInput = screen.getByLabelText('Brand Name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Versioned Brand' } });

    // Click the button to open the version modal (find the one that is not disabled)
    const saveAsVersionButtons = screen.getAllByRole('button', { name: /save as new version/i });
    const saveAsVersionButton = saveAsVersionButtons.find((btn) => !btn.hasAttribute('disabled'));
    expect(saveAsVersionButton).toBeDefined();
    fireEvent.click(saveAsVersionButton!);

    // Wait for modal to appear and find the save button inside it
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Click the "Save Version" button inside the modal
    const saveVersionButton = screen.getByRole('button', { name: /save version/i });
    fireEvent.click(saveVersionButton);

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

    // Find the Save Changes button that is NOT disabled
    const saveButtons = screen.getAllByRole('button', { name: /save changes/i });
    const saveButton = saveButtons.find((btn) => !btn.hasAttribute('disabled'));
    expect(saveButton).toBeDefined();
    fireEvent.click(saveButton!);

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

    // Find the Save Changes button that is NOT disabled
    const saveButtons = screen.getAllByRole('button', { name: /save changes/i });
    const saveButton = saveButtons.find((btn) => !btn.hasAttribute('disabled'));
    expect(saveButton).toBeDefined();
    fireEvent.click(saveButton!);

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

    // Find the Discard Changes button that is NOT disabled
    const discardButtons = screen.getAllByRole('button', { name: /discard changes/i });
    const discardButton = discardButtons.find((btn) => !btn.hasAttribute('disabled'));
    expect(discardButton).toBeDefined();
    fireEvent.click(discardButton!);

    await waitFor(() => {
      expect(serviceMocks.mockFetchConfig).toHaveBeenCalledTimes(2);
    });

    // After discard, all Save Changes buttons should be disabled
    await waitFor(() => {
      const saveButtons = screen.getAllByRole('button', { name: /save changes/i });
      expect(saveButtons.every((btn) => btn.hasAttribute('disabled'))).toBe(true);
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

    // Wait for the confirmation modal and click the confirm button
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    // Find and click the Revert button in the modal footer
    const confirmRevertButton = screen
      .getAllByRole('button', { name: /revert/i })
      .find((btn) => btn.closest('.modal-footer'));
    expect(confirmRevertButton).toBeDefined();
    fireEvent.click(confirmRevertButton!);

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
