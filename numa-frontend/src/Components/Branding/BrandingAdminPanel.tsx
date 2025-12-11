import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Form,
  ListGroup,
  Modal,
  OverlayTrigger,
  Row,
  Spinner,
  Tooltip,
} from 'react-bootstrap';
import {
  BrandingAdminService,
  sanitizeFileName,
  type BrandingSavePayload,
  type BrandingVersionSummary,
} from '../../Services/BrandingAdminService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { DEFAULT_BRANDING_THEME } from '../../Providers/BrandingContext';
import type { BrandingTheme, BrandingColors } from '../../Providers/BrandingContext';
import { useAuth } from '../../Providers/AuthProvider';
import { getSignedUrlForS3Object, uploadFileToS3, resolveS3Location, buildS3HttpsUrl } from '../../utils/s3Utils';
import { useToast } from '../../Providers/ToastContext';
import { brandingService, BRANDING_PREVIEW_KEY } from '../../Services/BrandingService';

type AssetType = 'logoNav' | 'logoLoginRight' | 'favicon';

type BrandingAssets = NonNullable<BrandingSavePayload['branding']['assets']>;
type BrandingFormColors = BrandingColors & Record<string, string>;

type BrandingFormState = Omit<BrandingTheme, 'colors' | 'splashScreen' | 'loginPage'> & {
  colors: BrandingFormColors;
  splashScreen: NonNullable<BrandingTheme['splashScreen']>;
  loginPage: NonNullable<BrandingTheme['loginPage']>;
  assets: BrandingAssets;
};

type UploadState = Record<AssetType, boolean>;

type AssetConstraint = {
  label: string;
  accept: string;
  maxSizeKb: number;
  description: string;
};

const COLOR_GROUPS: Array<{ title: string; fields: Array<{ key: string; label: string }> }> = [
  {
    title: 'Brand Palette',
    fields: [
      { key: 'primary', label: 'Primary' },
      { key: 'primaryContrast', label: 'Primary Contrast' },
      { key: 'hover', label: 'Hover' },
    ],
  },
  {
    title: 'Surface & Background',
    fields: [
      { key: 'surface', label: 'Surface' },
      { key: 'surfaceContrast', label: 'Surface Contrast' },
      { key: 'border', label: 'Border' },
      { key: 'background', label: 'Background' },
    ],
  },
  {
    title: 'Typography',
    fields: [
      { key: 'text', label: 'Primary Text' },
      { key: 'textMuted', label: 'Muted Text' },
    ],
  },
  {
    title: 'Primary Button',
    fields: [
      { key: 'buttonPrimary', label: 'Fill' },
      { key: 'buttonPrimaryText', label: 'Text' },
      { key: 'buttonPrimaryHover', label: 'Hover' },
      { key: 'buttonPrimaryBorder', label: 'Border' },
    ],
  },
  {
    title: 'Secondary Button',
    fields: [
      { key: 'buttonSecondary', label: 'Fill' },
      { key: 'buttonSecondaryText', label: 'Text' },
      { key: 'buttonSecondaryHover', label: 'Hover' },
      { key: 'buttonSecondaryHoverText', label: 'Hover Text' },
      { key: 'buttonSecondaryBorder', label: 'Border' },
    ],
  },
];

const ASSET_CONSTRAINTS: Record<AssetType, AssetConstraint> = {
  logoNav: {
    label: 'Navigation Logo',
    accept: '.svg,.png,.jpg,.jpeg,.webp',
    maxSizeKb: 1500,
    description: 'SVG, PNG, JPG, or WebP up to 800 KB. Displayed at max-height 48px with auto width.',
  },
  logoLoginRight: {
    label: 'Login Panel Image',
    accept: '.svg,.png,.jpg,.jpeg,.webp',
    maxSizeKb: 1500,
    description: 'SVG, PNG, JPG, or WebP up to 1.5 MB. Use responsive-friendly dimensions.',
  },
  favicon: {
    label: 'Favicon',
    accept: '.ico,.png',
    maxSizeKb: 500,
    description: 'ICO or PNG up to 150 KB. Provide multi-size favicon if available.',
  },
};

const DEFAULT_COLOR_MAP = DEFAULT_BRANDING_THEME.colors as Record<string, string | undefined>;

const resolveColorValue = (colors: BrandingFormColors, key: string, fallback: string): string => {
  return colors?.[key] ?? DEFAULT_COLOR_MAP[key] ?? fallback;
};

const EMPTY_PREVIEW_URLS: Record<AssetType, string | undefined> = {
  logoNav: undefined,
  logoLoginRight: undefined,
  favicon: undefined,
};

const DEFAULT_BRANDING: BrandingFormState = {
  ...DEFAULT_BRANDING_THEME,
  colors: {
    ...DEFAULT_BRANDING_THEME.colors,
  },
  splashScreen: {
    ...DEFAULT_BRANDING_THEME.splashScreen!,
  },
  loginPage: {
    ...DEFAULT_BRANDING_THEME.loginPage!,
  },
  assets: {
    logoNav: null,
    logoLoginRight: null,
    favicon: null,
  },
};

const mergeBranding = (incoming?: BrandingSavePayload['branding']): BrandingFormState => {
  return {
    ...DEFAULT_BRANDING,
    ...(incoming ?? {}),
    colors: {
      ...DEFAULT_BRANDING.colors,
      ...(incoming?.colors ?? {}),
    },
    splashScreen: {
      ...DEFAULT_BRANDING.splashScreen,
      ...(incoming?.splashScreen ?? {}),
    },
    loginPage: {
      ...DEFAULT_BRANDING.loginPage,
      ...(incoming?.loginPage ?? {}),
    },
    assets: {
      ...DEFAULT_BRANDING.assets,
      ...(incoming?.assets ?? {}),
    },
  };
};

const getFileValidationError = (type: AssetType, file: File): string | null => {
  const constraint = ASSET_CONSTRAINTS[type];
  if (!constraint) {
    return null;
  }

  const isValidType = constraint.accept
    .split(',')
    .map((ext) => ext.trim().toLowerCase())
    .some((ext) => file.name.toLowerCase().endsWith(ext));

  if (!isValidType) {
    return `${constraint.label}: Unsupported file type.`;
  }
  if (file.size > constraint.maxSizeKb * 1024) {
    return `${constraint.label}: File exceeds ${constraint.maxSizeKb} KB.`;
  }
  return null;
};

type BrandingAdminPanelProps = {
  onDirtyChange?: (dirty: boolean) => void;
};

const BrandingAdminPanel: React.FC<BrandingAdminPanelProps> = ({ onDirtyChange }) => {
  const { numaGet, numaPut, numaPost } = useNumaRequest();
  const { getCredentials } = useAuth();
  const s3Region = sessionStorage.getItem('REGION') || '';
  const s3Bucket = sessionStorage.getItem('BRANDING_ASSETS_BUCKET') || '';
  const s3Prefix = sessionStorage.getItem('BRANDING_ASSETS_PREFIX') || '';
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [enabled, setEnabled] = useState<boolean>(false);
  const [branding, setBranding] = useState<BrandingFormState>(DEFAULT_BRANDING);
  const [history, setHistory] = useState<BrandingVersionSummary[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState<boolean>(false);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [uploading, setUploading] = useState<UploadState>({
    logoNav: false,
    logoLoginRight: false,
    favicon: false,
  });
  const [previewUrls, setPreviewUrls] = useState<Record<AssetType, string | undefined>>(EMPTY_PREVIEW_URLS);
  const dirtyRef = useRef<boolean>(false);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [palettePrimaryHovered, setPalettePrimaryHovered] = useState(false);
  const [previewPrimaryHovered, setPreviewPrimaryHovered] = useState(false);
  const [previewSecondaryHovered, setPreviewSecondaryHovered] = useState(false);
  const [paletteSecondaryHovered, setPaletteSecondaryHovered] = useState(false);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [versionLabel, setVersionLabel] = useState('');
  const [previewingVersionId, setPreviewingVersionId] = useState<string | null>(null);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [revertTargetVersion, setRevertTargetVersion] = useState<BrandingVersionSummary | null>(null);
  const { showToast } = useToast();
  // Mark the form as dirty
  const markDirty = useCallback(() => {
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      setIsDirty(true);
      onDirtyChange?.(true);
    }
  }, [onDirtyChange]);

  const loadConfig = useCallback(
    async (options?: { force?: boolean }) => {
      try {
        setLoading(true);
        const result = await BrandingAdminService.fetchConfig(numaGet);
        const nextEnabled = Boolean(result.enabled);
        const nextBranding = mergeBranding(result.branding);
        setHistory(result.history ?? []);
        setHistoryLoaded(Boolean(result.history));

        if (options?.force || !dirtyRef.current) {
          dirtyRef.current = false;
          setIsDirty(false);
          onDirtyChange?.(false);
          setEnabled(nextEnabled);
          setBranding(nextBranding);
        }

        sessionStorage.setItem('BRANDING_THEME_ENABLED', nextEnabled ? 'true' : 'false');

        const runtimeBranding: BrandingTheme = nextEnabled ? { ...nextBranding } : { ...DEFAULT_BRANDING_THEME };
        brandingService.applyExternalBranding(runtimeBranding, {}, { persist: true, tenantEnabled: nextEnabled });
      } catch (error) {
        showToast({
          variant: 'error',
          title: 'Branding configuration',
          message: (error as Error).message || 'Failed to load branding configuration',
        });
      } finally {
        setLoading(false);
      }
    },
    [numaGet],
  );

  const resetToDefault = useCallback(() => {
    const defaults = mergeBranding();
    setEnabled(true);
    setBranding(defaults);
    dirtyRef.current = true;
    setIsDirty(true);
    showToast({ variant: 'info', message: 'Reset to default branding' });
    onDirtyChange?.(true);
  }, [onDirtyChange]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const previewColors = useMemo(() => {
    const getColor = (key: string, fallback: string) => resolveColorValue(branding.colors, key, fallback);

    const primary = getColor('primary', '#8e50a7');
    const primaryContrast = getColor('primaryContrast', '#ffffff');
    const surface = getColor('surface', '#ffffff');
    const surfaceContrast = getColor('surfaceContrast', '#111827');
    const border = getColor('border', '#d1d5db');
    const text = getColor('text', '#111827');
    const textMuted = getColor('textMuted', '#6b7280');
    const background = getColor('background', '#f3f4f6');
    const buttonPrimary = getColor('buttonPrimary', primary);
    const buttonPrimaryBorder = getColor('buttonPrimaryBorder', buttonPrimary);
    const buttonPrimaryText = getColor('buttonPrimaryText', primaryContrast);
    const hover = getColor('hover', '#744188');
    const buttonPrimaryHover = getColor('buttonPrimaryHover', hover);
    const buttonSecondary = getColor('buttonSecondary', surface);
    const buttonSecondaryText = getColor('buttonSecondaryText', text);
    const buttonSecondaryHover = getColor('buttonSecondaryHover', '#f3f4f6');
    const buttonSecondaryHoverText = getColor('buttonSecondaryHoverText', '#ffffff');
    const buttonSecondaryBorder = getColor('buttonSecondaryBorder', border);
    const secondary = getColor('secondary', '#6b3c85');
    const messageUser = getColor('messageUser', primary);

    return {
      primary,
      primaryContrast,
      surface,
      surfaceContrast,
      border,
      text,
      textMuted,
      background,
      buttonPrimary,
      buttonPrimaryBorder,
      buttonPrimaryText,
      buttonPrimaryHover,
      buttonSecondary,
      buttonSecondaryText,
      buttonSecondaryHover,
      buttonSecondaryHoverText,
      buttonSecondaryBorder,
      secondary,
      hover,
      messageUser,
    };
  }, [branding.colors]);

  const renderGroupPreview = (groupTitle: string) => {
    switch (groupTitle) {
      case 'Brand Palette':
        return (
          <div
            className="rounded-3 p-3 text-center"
            style={{ background: previewColors.primary, color: previewColors.primaryContrast }}
          >
            <div className="small text-uppercase fw-semibold">Primary</div>
            <div className="fw-semibold">{previewColors.primary}</div>
          </div>
        );
      case 'Surface & Background':
        return (
          <div className="rounded-3 border p-3" style={{ background: previewColors.background }}>
            <div
              className="rounded-3 p-3 mb-3"
              style={{
                background: previewColors.surface,
                border: `1px solid ${previewColors.border}`,
                color: previewColors.surfaceContrast,
              }}
            >
              <div className="fw-semibold">Surface component</div>
              <div className="text-muted" style={{ color: previewColors.textMuted }}>
                Cards and panels inherit these tones.
              </div>
            </div>
            <div
              className="rounded-3 p-3"
              style={{
                background: previewColors.background,
                border: `1px dashed ${previewColors.border}`,
                color: previewColors.text,
              }}
            >
              Page background preview
            </div>
          </div>
        );
      case 'Typography':
        return (
          <div className="rounded-3 border p-3" style={{ background: '#ffffff' }}>
            <h5 className="fw-semibold" style={{ color: previewColors.text }}>
              Heading preview
            </h5>
            <p className="mb-0" style={{ color: previewColors.textMuted }}>
              Supporting copy reflects muted typography. Adjust values to test legibility.
            </p>
          </div>
        );
      case 'Primary Button':
        return (
          <Button
            onMouseEnter={() => setPalettePrimaryHovered(true)}
            onMouseLeave={() => setPalettePrimaryHovered(false)}
            onFocus={() => setPalettePrimaryHovered(true)}
            onBlur={() => setPalettePrimaryHovered(false)}
            style={{
              background: palettePrimaryHovered ? previewColors.buttonPrimaryHover : previewColors.buttonPrimary,
              border: `1px solid ${previewColors.buttonPrimaryBorder}`,
              color: previewColors.buttonPrimaryText,
            }}
          >
            Primary Action
          </Button>
        );
      case 'Secondary Button':
        return (
          <div className="d-flex flex-column gap-2">
            <Button
              variant="secondary"
              onMouseEnter={() => setPaletteSecondaryHovered(true)}
              onMouseLeave={() => setPaletteSecondaryHovered(false)}
              onFocus={() => setPaletteSecondaryHovered(true)}
              onBlur={() => setPaletteSecondaryHovered(false)}
              style={{
                background: paletteSecondaryHovered
                  ? previewColors.buttonSecondaryHover
                  : previewColors.buttonSecondary,
                color: paletteSecondaryHovered
                  ? previewColors.buttonSecondaryHoverText
                  : previewColors.buttonSecondaryText,
                border: `1px solid ${previewColors.buttonSecondaryBorder}`,
              }}
            >
              Secondary Action
            </Button>
            <Button variant="link" style={{ color: previewColors.buttonSecondaryText }}>
              Text Link Example
            </Button>
          </div>
        );
      default:
        return <div className="rounded-3 border p-3 text-muted">Adjust colors to see real-time preview here.</div>;
    }
  };

  const handleColorInput = (key: string) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    markDirty();
    setBranding((prev) => ({
      ...prev,
      colors: {
        ...prev.colors,
        [key]: value,
      },
    }));
  };

  const handleBrandNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    markDirty();
    setBranding((prev) => ({
      ...prev,
      name: value,
    }));
  };

  const handleLoginUpdate =
    (field: 'title' | 'welcomeMessage') => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      markDirty();
      setBranding((prev) => ({
        ...prev,
        loginPage: {
          ...prev.loginPage,
          [field]: value,
        },
      }));
    };

  const handleSplashUpdate =
    (field: 'title' | 'description' | 'textColor' | 'showPanel') =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = field === 'showPanel' ? (event.target as HTMLInputElement).checked : event.target.value;
      markDirty();
      setBranding((prev) => ({
        ...prev,
        splashScreen: {
          ...prev.splashScreen,
          [field]: value,
        },
      }));
    };

  // Convert S3 URI or HTTPS URL to unsigned HTTPS URL for display
  // (used for thumbnails where signing isn't critical)
  const toPreviewUrl = (uri: string): string => {
    if (!uri) return uri;
    // If already HTTPS, return as-is (might be presigned)
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      return uri;
    }
    // Try to parse and convert to HTTPS
    const parsed = resolveS3Location(uri);
    if (parsed && s3Region) {
      return buildS3HttpsUrl(parsed.bucket, parsed.key, s3Region) || uri;
    }
    return uri;
  };

  const openAssetInNewTab = async (uri: string | undefined) => {
    if (!uri) {
      return;
    }

    const parsed = resolveS3Location(uri);
    if (!parsed || !s3Region) {
      // If we can't parse, just open the URL directly (might be a presigned URL)
      window.open(uri, '_blank');
      return;
    }

    try {
      const signedUrl = await getSignedUrlForS3Object(parsed.key, parsed.bucket, s3Region, getCredentials);
      window.open(signedUrl, '_blank');
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Open asset failed',
        message: (error as Error).message || 'Failed to open asset',
      });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const refreshPreviews = async () => {
      const entries = await Promise.all(
        (Object.keys(ASSET_CONSTRAINTS) as AssetType[]).map(async (type) => {
          const uri = branding.assets?.[type];
          if (!uri) {
            return [type, undefined] as const;
          }

          const parsed = resolveS3Location(uri);
          if (!parsed || !s3Region) {
            // Can't parse - might already be a presigned URL, use as-is
            return [type, uri] as const;
          }

          try {
            const signedUrl = await getSignedUrlForS3Object(parsed.key, parsed.bucket, s3Region, getCredentials, 300);
            return [type, signedUrl] as const;
          } catch (error) {
            console.error('Failed to generate preview URL for asset', { type, error });
            return [type, uri] as const;
          }
        }),
      );

      if (!cancelled) {
        setPreviewUrls(Object.fromEntries(entries) as Record<AssetType, string | undefined>);
      }
    };

    void refreshPreviews();

    return () => {
      cancelled = true;
    };
  }, [branding.assets, getCredentials, s3Region]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, []);

  const applyAssetUrl = (type: AssetType, url: string) => {
    markDirty();
    setBranding((prev) => {
      const next: BrandingFormState = {
        ...prev,
        assets: {
          ...prev.assets,
          [type]: url,
        },
      };

      if (type === 'logoNav') {
        next.logo = url;
        next.logoSmall = url;
      }
      if (type === 'favicon') {
        next.favicon = url;
      }
      if (type === 'logoLoginRight') {
        next.splashScreen = {
          ...next.splashScreen,
          image: url,
        };
      }
      return next;
    });
  };

  const buildAssetKey = (type: AssetType, fileName: string) => {
    const timestamp = Date.now();
    const sanitized = sanitizeFileName(fileName || `${type}-asset`);
    const normalizedPrefix = s3Prefix.replace(/\/+$/, '');
    const parts = [normalizedPrefix, type, `${timestamp}-${sanitized}`].filter(Boolean);
    const key = parts.join('/');
    return key;
  };

  const uploadAsset = async (type: AssetType, file: File) => {
    const validationError = getFileValidationError(type, file);
    if (validationError) {
      showToast({ variant: 'warning', title: 'Upload blocked', message: validationError });
      return;
    }

    if (!s3Region || !s3Bucket) {
      showToast({
        variant: 'error',
        title: `${ASSET_CONSTRAINTS[type].label}`,
        message: 'Branding S3 configuration is missing. Check REGION and BRANDING_ASSETS_BUCKET values.',
      });
      console.error('Branding upload aborted: missing S3 configuration', {
        s3Region,
        s3Bucket,
        s3Prefix,
      });
      return;
    }

    try {
      setUploading((prev) => ({ ...prev, [type]: true }));

      const key = buildAssetKey(type, file.name);
      const arrayBuffer = await file.arrayBuffer();
      await uploadFileToS3(arrayBuffer, file.type, s3Bucket, key, s3Region, getCredentials);

      const assetUri = `s3://${s3Bucket}/${key}`;

      applyAssetUrl(type, assetUri);

      showToast({
        variant: 'success',
        title: `${ASSET_CONSTRAINTS[type].label}`,
        message: 'Uploaded successfully. Remember to save changes to apply.',
        autoHideDurationMs: 6000,
      });
    } catch (error) {
      console.error('Branding asset upload failed', {
        type,
        error,
      });
      showToast({
        variant: 'error',
        title: `${ASSET_CONSTRAINTS[type].label}`,
        message: (error as Error).message || 'Asset upload failed',
      });
    } finally {
      setUploading((prev) => ({ ...prev, [type]: false }));
    }
  };

  const onFileChange = (type: AssetType) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void uploadAsset(type, file);
      event.target.value = '';
    }
  };

  const saveChanges = async (options?: { createVersion?: boolean; label?: string }) => {
    try {
      setSaving(true);
      showToast({ variant: 'info', message: 'Saving branding changes…' });

      const trimmedColors = Object.fromEntries(
        Object.entries(branding.colors).map(([key, value]) => [key, value?.trim?.() ?? value ?? '']),
      ) as BrandingFormState['colors'];

      const payload: BrandingSavePayload = {
        enabled,
        branding: {
          ...branding,
          colors: trimmedColors,
        },
        createVersion: options?.createVersion,
        label: options?.label,
      };

      await BrandingAdminService.saveConfig(numaPut, payload);
      showToast({ variant: 'success', message: 'Branding settings saved successfully.' });
      sessionStorage.setItem('BRANDING_THEME_ENABLED', enabled ? 'true' : 'false');
      await loadConfig({ force: true });
      setHistoryLoaded(false);
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Save failed',
        message: (error as Error).message || 'Failed to save branding settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveVersion = async () => {
    setShowVersionModal(false);
    await saveChanges({ createVersion: true, label: versionLabel.trim() || undefined });
    setVersionLabel('');
  };

  const openVersionModal = () => {
    setVersionLabel(new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
    setShowVersionModal(true);
  };

  const previewVersion = async (versionId: string) => {
    try {
      setPreviewingVersionId(versionId);
      showToast({ variant: 'info', message: 'Loading preview...' });

      // Fetch the full version config from backend
      const versionConfig = await BrandingAdminService.fetchVersion(numaGet, versionId);

      if (!versionConfig.branding) {
        throw new Error('Version config not found');
      }

      // Store preview branding data in sessionStorage for the new tab
      const previewData = {
        branding: mergeBranding(versionConfig.branding),
      };
      sessionStorage.setItem(BRANDING_PREVIEW_KEY, JSON.stringify(previewData));

      // Open new tab to the home page - it will pick up the preview branding
      window.open('/', '_blank');

      showToast({
        variant: 'info',
        title: 'Preview opened',
        message: 'A new tab has opened with a preview of this branding version. Close the tab when done.',
        autoHideDurationMs: 6000,
      });
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Preview failed',
        message: (error as Error).message || 'Failed to load version for preview',
      });
    } finally {
      setPreviewingVersionId(null);
    }
  };

  const fetchHistoryIfNeeded = useCallback(async () => {
    if (historyLoaded || historyLoading) {
      return;
    }
    try {
      setHistoryLoading(true);
      const result = await BrandingAdminService.fetchHistory(numaGet);
      setHistory(result.history ?? []);
      setHistoryLoaded(true);
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'History failed',
        message: (error as Error).message || 'Failed to load version history',
      });
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoaded, historyLoading, numaGet, showToast]);

  const revertVersion = async (versionId: string) => {
    try {
      setSaving(true);
      showToast({ variant: 'info', message: 'Restoring branding version…' });

      const result = await BrandingAdminService.revertVersion(numaPost, versionId);
      const revertedEnabled = Boolean(result.enabled);
      const merged = mergeBranding(result.branding);
      setEnabled(revertedEnabled);
      setBranding(merged);
      sessionStorage.setItem('BRANDING_THEME_ENABLED', revertedEnabled ? 'true' : 'false');
      brandingService.applyExternalBranding(
        revertedEnabled ? { ...merged } : { ...DEFAULT_BRANDING_THEME },
        {},
        { persist: true, tenantEnabled: revertedEnabled },
      );
      setHistory(result.history ?? []);
      setHistoryLoaded(true);
      showToast({ variant: 'success', message: 'Version restored successfully.' });
    } catch (error) {
      showToast({
        variant: 'error',
        title: 'Restore failed',
        message: (error as Error).message || 'Failed to revert version',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" variant="primary" />
      </div>
    );
  }

  return (
    <div className="d-flex flex-column gap-3">
      {isDirty && (
        <Alert
          variant="warning"
          className="position-sticky mb-0 d-flex justify-content-between align-items-center shadow-sm"
          style={{
            top: '1rem',
            zIndex: 1020,
            backgroundColor: '#fff4e5',
            borderColor: '#ffc107',
          }}
        >
          <div className="d-flex align-items-center">
            <i className="bi bi-exclamation-circle me-2" />
            <span>
              <strong>Unsaved changes.</strong> Your modifications have not been saved yet.
            </span>
          </div>
          <div className="d-flex gap-2">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => void loadConfig({ force: true })}
              disabled={saving}
            >
              Discard
            </Button>
            <Button variant="warning" size="sm" onClick={() => void saveChanges()} disabled={saving}>
              {saving ? <Spinner animation="border" size="sm" /> : 'Save Now'}
            </Button>
          </div>
        </Alert>
      )}
      <div>
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h5 className="mb-1 fw-semibold">Branding Controls</h5>
            <p className="text-muted mb-0 small">
              Manage tenant branding, colors, and assets. Changes publish immediately after saving.
            </p>
          </div>
          <Form.Check
            type="switch"
            id="branding-enabled-toggle"
            label={<span className="ms-2">{enabled ? 'Branding enabled' : 'Branding disabled'}</span>}
            checked={enabled}
            onChange={(event) => {
              markDirty();
              setEnabled(event.target.checked);
            }}
          />
        </div>

        <Accordion alwaysOpen={false} className="mb-3">
          <Accordion.Item eventKey="history">
            <Accordion.Header
              onClick={() => {
                void fetchHistoryIfNeeded();
              }}
            >
              <i className="bi bi-clock-history me-2" />
              Version History
            </Accordion.Header>
            <Accordion.Body>
              {historyLoading ? (
                <div className="d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" />
                  <span>Loading versions…</span>
                </div>
              ) : history.length === 0 ? (
                <div className="text-muted">
                  No published versions yet. Save a new version to create a restore point.
                </div>
              ) : (
                <ListGroup variant="flush">
                  {history.map((item) => {
                    console.log('Version history item:', item);
                    const formattedTimestamp = item.updatedAt
                      ? new Date(item.updatedAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : undefined;
                    const displayLabel = item.label || formattedTimestamp || item.versionId;
                    const metaParts: string[] = [];
                    if (formattedTimestamp && formattedTimestamp !== displayLabel) {
                      metaParts.push(formattedTimestamp);
                    }
                    metaParts.push(item.updatedBy || 'system');

                    return (
                      <ListGroup.Item
                        key={item.versionId}
                        className="d-flex justify-content-between align-items-center"
                      >
                        <div className="d-flex align-items-center gap-3">
                          {item.primaryColor && (
                            <div
                              className="rounded-2 flex-shrink-0"
                              style={{
                                width: 24,
                                height: 24,
                                backgroundColor: item.primaryColor,
                                border: '1px solid rgba(0,0,0,0.1)',
                              }}
                              title={`Primary color: ${item.primaryColor}`}
                            />
                          )}
                          <div
                            className="rounded-2 flex-shrink-0 d-flex align-items-center justify-content-center"
                            style={{
                              width: 24,
                              height: 24,
                              border: '1px solid rgba(0,0,0,0.1)',
                              backgroundColor: '#f8f9fa',
                              overflow: 'hidden',
                            }}
                            title="Navigation logo"
                          >
                            <img
                              src={item.logoNav ? toPreviewUrl(item.logoNav) : '/numa-logo.svg'}
                              alt={item.logoNav ? 'Logo' : 'Default logo'}
                              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                            />
                          </div>
                          <div>
                            <div className="fw-semibold">{displayLabel}</div>
                            <div className="small text-muted">{metaParts.join(' · ')}</div>
                          </div>
                        </div>
                        <div className="d-flex gap-2">
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => void previewVersion(item.versionId)}
                            disabled={saving || previewingVersionId === item.versionId}
                          >
                            {previewingVersionId === item.versionId ? (
                              <Spinner animation="border" size="sm" />
                            ) : (
                              <>
                                <i className="bi bi-eye me-1" />
                                Preview
                              </>
                            )}
                          </Button>
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => {
                              setRevertTargetVersion(item);
                              setShowRevertModal(true);
                            }}
                            disabled={saving}
                          >
                            Revert
                          </Button>
                        </div>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>

        {!enabled ? (
          <Alert variant="info" className="mb-0 d-flex align-items-center">
            <i className="bi bi-info-circle-fill me-2 fs-5" />
            <div>
              <strong>Branding is currently disabled.</strong> Please enable branding above to modify the Numa component
              colour scheme and login panels.
            </div>
          </Alert>
        ) : (
          <div>
            <div className="d-flex flex-wrap gap-2 justify-content-between mb-3">
              <Button variant="secondary" size="sm" onClick={resetToDefault} disabled={saving}>
                Reset to Default
              </Button>
              <div className="d-flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadConfig({ force: true })}
                  disabled={saving || !isDirty}
                >
                  Discard Changes
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => void saveChanges()}
                  disabled={saving || !isDirty}
                >
                  {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-check-lg me-2" />}
                  Save Changes
                </Button>
                <Button variant="primary" size="sm" onClick={openVersionModal} disabled={saving || !isDirty}>
                  {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-layers me-2" />}
                  Save as New Version
                </Button>
              </div>
            </div>

            <h6 className="fw-semibold text-uppercase text-muted small mb-3">Color Palette</h6>
            <Row className="gy-4 align-items-start">
              <Col xs={12} xl={7}>
                <div>
                  <div className="d-flex flex-column gap-4">
                    {COLOR_GROUPS.map(({ title, fields }) => (
                      <div key={title} className="border rounded-3 p-3">
                        <div className="d-flex flex-column flex-lg-row gap-4">
                          <div className="flex-fill">
                            <div className="border-bottom pb-1 mb-3">
                              <span className="text-uppercase text-muted small fw-semibold">{title}</span>
                            </div>
                            <div className="d-flex flex-column gap-3">
                              {fields.map(({ key, label }) => (
                                <div key={key} className="d-flex align-items-center gap-3">
                                  <Form.Label className="mb-0" style={{ width: '160px' }}>
                                    {label}
                                  </Form.Label>
                                  <Form.Control
                                    type="color"
                                    value={branding.colors?.[key] || '#ffffff'}
                                    onChange={handleColorInput(key)}
                                    style={{ maxWidth: '64px' }}
                                  />
                                  <Form.Control
                                    type="text"
                                    value={branding.colors?.[key] || ''}
                                    onChange={handleColorInput(key)}
                                    placeholder="#000000"
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="flex-fill">{renderGroupPreview(title)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 border-top pt-3">
                    <h6 className="fw-semibold text-uppercase text-muted small mb-3">Branding Details</h6>
                    <div className="d-flex flex-column gap-3">
                      <Form.Group controlId="branding-name">
                        <Form.Label>Brand Name</Form.Label>
                        <Form.Control
                          type="text"
                          value={branding.name || ''}
                          onChange={handleBrandNameChange}
                          placeholder="Client brand name"
                        />
                      </Form.Group>
                      <Form.Group controlId="branding-login-title">
                        <Form.Label>Login Page Title</Form.Label>
                        <Form.Control
                          type="text"
                          value={branding.loginPage?.title || ''}
                          onChange={handleLoginUpdate('title')}
                        />
                      </Form.Group>
                      <Form.Group controlId="branding-login-message">
                        <Form.Label>Login Welcome Message</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={2}
                          value={branding.loginPage?.welcomeMessage || ''}
                          onChange={handleLoginUpdate('welcomeMessage')}
                        />
                      </Form.Group>
                    </div>
                  </div>
                  <div className="mt-4 border-top pt-3">
                    <h6 className="fw-semibold text-uppercase text-muted small mb-3">Splash Screen</h6>
                    <div className="d-flex flex-column gap-3">
                      <Form.Group controlId="branding-splash-title">
                        <Form.Label>Splash Title</Form.Label>
                        <Form.Control
                          type="text"
                          value={branding.splashScreen?.title || ''}
                          onChange={handleSplashUpdate('title')}
                          placeholder="Main heading on login splash panel"
                        />
                      </Form.Group>
                      <Form.Group controlId="branding-splash-description">
                        <Form.Label>Splash Description</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={2}
                          value={branding.splashScreen?.description || ''}
                          onChange={handleSplashUpdate('description')}
                          placeholder="Description text below the title"
                        />
                      </Form.Group>
                      <Form.Group controlId="branding-splash-text-color">
                        <Form.Label>Splash Text Color</Form.Label>
                        <div className="d-flex align-items-center gap-2">
                          <Form.Control
                            type="color"
                            value={branding.splashScreen?.textColor || '#ffffff'}
                            onChange={handleSplashUpdate('textColor')}
                            style={{ width: '50px', height: '32px', padding: '2px' }}
                          />
                          <Form.Text className="text-muted mb-0">Default: white</Form.Text>
                        </div>
                      </Form.Group>
                      <Form.Group controlId="branding-splash-show-panel">
                        <Form.Check
                          type="checkbox"
                          label="Show semi-transparent background panel"
                          checked={branding.splashScreen?.showPanel || false}
                          onChange={handleSplashUpdate('showPanel')}
                        />
                      </Form.Group>
                    </div>
                  </div>
                </div>
              </Col>
              <Col xs={12} xl={5}>
                <div className="position-sticky" style={{ top: '1rem' }}>
                  <Card className="h-100" style={{ background: previewColors.background }}>
                    <Card.Body className="d-flex flex-column gap-3">
                      <Card.Title className="fs-6 mb-0">Preview</Card.Title>
                      <div
                        className="rounded-3 p-3"
                        style={{ background: previewColors.surface, border: `1px solid ${previewColors.border}` }}
                      >
                        <div className="d-flex justify-content-between align-items-center">
                          <div className="d-flex align-items-center gap-2">
                            <span
                              className="rounded-circle d-inline-flex align-items-center justify-content-center"
                              style={{
                                width: '40px',
                                height: '40px',
                                background: previewColors.primary,
                                color: previewColors.primaryContrast,
                                fontWeight: 600,
                              }}
                            >
                              {branding.name?.substring(0, 2).toUpperCase() || 'BR'}
                            </span>
                            <span style={{ color: previewColors.surfaceContrast, fontWeight: 600 }}>
                              {branding.name || 'Brand'}
                            </span>
                          </div>
                          <Badge
                            bg="light"
                            text="dark"
                            style={{ border: `1px solid ${previewColors.border}`, color: previewColors.text }}
                          >
                            Active
                          </Badge>
                        </div>
                      </div>

                      <div className="d-flex gap-2">
                        <Button
                          onMouseEnter={() => setPreviewPrimaryHovered(true)}
                          onMouseLeave={() => setPreviewPrimaryHovered(false)}
                          onFocus={() => setPreviewPrimaryHovered(true)}
                          onBlur={() => setPreviewPrimaryHovered(false)}
                          style={{
                            background: previewPrimaryHovered
                              ? previewColors.buttonPrimaryHover
                              : previewColors.buttonPrimary,
                            border: `1px solid ${previewColors.buttonPrimaryBorder}`,
                            color: previewColors.buttonPrimaryText,
                          }}
                        >
                          Primary Action
                        </Button>
                        <Button
                          variant="outline-primary"
                          onMouseEnter={() => setPreviewSecondaryHovered(true)}
                          onMouseLeave={() => setPreviewSecondaryHovered(false)}
                          onFocus={() => setPreviewSecondaryHovered(true)}
                          onBlur={() => setPreviewSecondaryHovered(false)}
                          style={{
                            background: previewSecondaryHovered
                              ? previewColors.buttonSecondaryHover
                              : previewColors.buttonSecondary,
                            color: previewSecondaryHovered
                              ? previewColors.buttonSecondaryHoverText
                              : previewColors.buttonSecondaryText,
                            border: `1px solid ${previewColors.buttonSecondaryBorder}`,
                          }}
                        >
                          Secondary Action
                        </Button>
                      </div>

                      <div>
                        <h5 style={{ color: previewColors.text }}>Section Header</h5>
                        <p style={{ color: previewColors.textMuted }}>
                          Supporting copy uses muted text color for hierarchy and readability.
                        </p>
                      </div>

                      <div
                        className="rounded-4 p-3 d-flex flex-column gap-3"
                        style={{
                          border: `1px solid ${previewColors.border}`,
                          background: previewColors.background,
                        }}
                      >
                        <div className="d-flex align-items-center gap-2">
                          <span
                            className="rounded-circle d-inline-flex align-items-center justify-content-center"
                            style={{
                              width: '36px',
                              height: '36px',
                              background: previewColors.primary,
                              color: previewColors.primaryContrast,
                              fontWeight: 600,
                            }}
                          >
                            N
                          </span>
                          <div className="d-flex flex-column">
                            <span className="fw-semibold" style={{ color: previewColors.text }}>
                              Numa Assistant
                            </span>
                            <small className="text-muted">Online</small>
                          </div>
                        </div>

                        <div className="d-flex flex-column gap-3">
                          <div
                            className="rounded-4 p-3 align-self-start"
                            style={{
                              background: previewColors.surface,
                              color: previewColors.surfaceContrast,
                              maxWidth: '85%',
                            }}
                          >
                            <p className="mb-1 fw-semibold">Numa Assistant</p>
                            <p className="mb-0" style={{ color: previewColors.textMuted }}>
                              Hi! I can help you with onboarding, training resources, or account updates. What would you
                              like to do today?
                            </p>
                          </div>

                          <div className="d-flex justify-content-end">
                            <div
                              className="rounded-4 p-3"
                              style={{
                                background: previewColors.messageUser,
                                color: previewColors.buttonPrimaryText,
                                maxWidth: '75%',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                              }}
                            >
                              I&apos;d like the onboarding checklist and the latest adoption metrics.
                            </div>
                          </div>
                        </div>

                        <div
                          className="d-flex gap-2 align-items-center pt-2 border-top"
                          style={{ borderColor: previewColors.border }}
                        >
                          <div
                            className="flex-grow-1 rounded-pill px-3 py-2 d-flex align-items-center gap-2"
                            style={{
                              background: previewColors.surface,
                              border: `1px solid ${previewColors.border}`,
                              color: previewColors.textMuted,
                            }}
                          >
                            <i className="bi bi-send" style={{ color: previewColors.textMuted }}></i>
                            <span>Type a message…</span>
                          </div>
                          <Button
                            size="sm"
                            style={{
                              background: previewColors.buttonPrimary,
                              border: `1px solid ${previewColors.buttonPrimaryBorder}`,
                              color: previewColors.buttonPrimaryText,
                            }}
                          >
                            Send
                          </Button>
                        </div>
                      </div>

                      <div
                        className="rounded-3 p-4"
                        style={{
                          border: `1px dashed ${previewColors.border}`,
                          background: previewColors.background,
                        }}
                      >
                        <div className="d-flex flex-column gap-2 text-center">
                          <span className="fw-semibold" style={{ color: previewColors.text }}>
                            Login Preview
                          </span>
                          <Button
                            size="sm"
                            style={{
                              background: previewColors.buttonPrimary,
                              border: `1px solid ${previewColors.buttonPrimaryBorder}`,
                              color: previewColors.buttonPrimaryText,
                            }}
                          >
                            Sign in
                          </Button>
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                </div>
              </Col>
            </Row>

            <Row className="mt-4 gy-4">
              {(Object.keys(ASSET_CONSTRAINTS) as AssetType[]).map((type) => {
                const constraint = ASSET_CONSTRAINTS[type];
                const currentUrl = branding.assets?.[type];
                const previewUrl = previewUrls[type] || (currentUrl ? toPreviewUrl(currentUrl) : undefined);
                return (
                  <Col key={type} md={4}>
                    <Card className="h-100">
                      <Card.Body className="d-flex flex-column">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <Card.Title className="fs-6 mb-0">{constraint.label}</Card.Title>
                          {uploading[type] && <Spinner animation="border" size="sm" />}
                        </div>
                        <OverlayTrigger placement="top" overlay={<Tooltip>{constraint.description}</Tooltip>}>
                          <Form.Text muted>{constraint.description}</Form.Text>
                        </OverlayTrigger>
                        <div className="mt-3">
                          <Form.Control type="file" accept={constraint.accept} onChange={onFileChange(type)} />
                        </div>
                        {previewUrl && (
                          <div className="mt-3 text-center">
                            {type === 'favicon' ? (
                              <img src={previewUrl} alt={`${constraint.label} preview`} width={32} height={32} />
                            ) : (
                              <img
                                src={previewUrl}
                                alt={`${constraint.label} preview`}
                                style={{
                                  maxHeight: type === 'logoNav' ? 48 : 120,
                                  maxWidth: '100%',
                                  objectFit: 'contain',
                                }}
                              />
                            )}
                            <div className="small mt-2">
                              <a
                                href="#"
                                onClick={(event) => {
                                  event.preventDefault();
                                  void openAssetInNewTab(currentUrl);
                                }}
                                rel="noopener noreferrer"
                              >
                                View asset
                              </a>
                            </div>
                          </div>
                        )}
                      </Card.Body>
                    </Card>
                  </Col>
                );
              })}
            </Row>
          </div>
        )}
        {enabled && (
          <div className="d-flex justify-content-end gap-2 mt-4 pt-3 border-top">
            <Button variant="secondary" onClick={() => void loadConfig({ force: true })} disabled={saving || !isDirty}>
              Discard Changes
            </Button>
            <Button variant="outline-secondary" onClick={() => void saveChanges()} disabled={saving || !isDirty}>
              {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-check-lg me-2" />}
              Save Changes
            </Button>
            <Button variant="primary" onClick={openVersionModal} disabled={saving || !isDirty}>
              {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-layers me-2" />}
              Save as New Version
            </Button>
          </div>
        )}
      </div>

      <Modal show={showVersionModal} onHide={() => setShowVersionModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Save as New Version</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">
            Create a named version of your current branding settings. You can restore to this version later.
          </p>
          <Form.Group controlId="version-label">
            <Form.Label>Version Name</Form.Label>
            <Form.Control
              type="text"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder="e.g., Holiday theme, Q4 rebrand"
              autoFocus
            />
            <Form.Text className="text-muted">Give this version a memorable name to help identify it later.</Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowVersionModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void handleSaveVersion()} disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : 'Save Version'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showRevertModal} onHide={() => setShowRevertModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Revert to Previous Version</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Are you sure you want to revert to{' '}
            <strong>{revertTargetVersion?.label || revertTargetVersion?.versionId}</strong>?
          </p>
          <p className="text-muted mb-0">
            This will replace your current branding settings with this version. Any unsaved changes will be lost.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRevertModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (revertTargetVersion) {
                setShowRevertModal(false);
                void revertVersion(revertTargetVersion.versionId);
              }
            }}
            disabled={saving}
          >
            {saving ? <Spinner animation="border" size="sm" /> : 'Revert'}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default BrandingAdminPanel;
