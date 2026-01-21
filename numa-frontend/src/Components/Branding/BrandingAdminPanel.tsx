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
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
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

type ColorGroupId = 'brandPalette' | 'surfaceBackground' | 'typography' | 'primaryButton' | 'secondaryButton';

type ColorGroup = {
  id: ColorGroupId;
  title: string;
  fields: Array<{ key: string; label: string }>;
};

const buildColorGroups = (t: (key: string) => string): ColorGroup[] => [
  {
    id: 'brandPalette',
    title: t('brandingAdmin.colors.groups.brandPalette.title'),
    fields: [
      { key: 'primary', label: t('brandingAdmin.colors.groups.brandPalette.primary') },
      { key: 'primaryContrast', label: t('brandingAdmin.colors.groups.brandPalette.primaryContrast') },
      { key: 'hover', label: t('brandingAdmin.colors.groups.brandPalette.hover') },
    ],
  },
  {
    id: 'surfaceBackground',
    title: t('brandingAdmin.colors.groups.surfaceBackground.title'),
    fields: [
      { key: 'surface', label: t('brandingAdmin.colors.groups.surfaceBackground.surface') },
      { key: 'surfaceContrast', label: t('brandingAdmin.colors.groups.surfaceBackground.surfaceContrast') },
      { key: 'border', label: t('brandingAdmin.colors.groups.surfaceBackground.border') },
      { key: 'background', label: t('brandingAdmin.colors.groups.surfaceBackground.background') },
    ],
  },
  {
    id: 'typography',
    title: t('brandingAdmin.colors.groups.typography.title'),
    fields: [
      { key: 'text', label: t('brandingAdmin.colors.groups.typography.text') },
      { key: 'textMuted', label: t('brandingAdmin.colors.groups.typography.textMuted') },
    ],
  },
  {
    id: 'primaryButton',
    title: t('brandingAdmin.colors.groups.primaryButton.title'),
    fields: [
      { key: 'buttonPrimary', label: t('brandingAdmin.colors.groups.primaryButton.fill') },
      { key: 'buttonPrimaryText', label: t('brandingAdmin.colors.groups.primaryButton.text') },
      { key: 'buttonPrimaryHover', label: t('brandingAdmin.colors.groups.primaryButton.hover') },
      { key: 'buttonPrimaryBorder', label: t('brandingAdmin.colors.groups.primaryButton.border') },
    ],
  },
  {
    id: 'secondaryButton',
    title: t('brandingAdmin.colors.groups.secondaryButton.title'),
    fields: [
      { key: 'buttonSecondary', label: t('brandingAdmin.colors.groups.secondaryButton.fill') },
      { key: 'buttonSecondaryText', label: t('brandingAdmin.colors.groups.secondaryButton.text') },
      { key: 'buttonSecondaryHover', label: t('brandingAdmin.colors.groups.secondaryButton.hover') },
      { key: 'buttonSecondaryHoverText', label: t('brandingAdmin.colors.groups.secondaryButton.hoverText') },
      { key: 'buttonSecondaryBorder', label: t('brandingAdmin.colors.groups.secondaryButton.border') },
    ],
  },
];

const buildAssetConstraints = (t: (key: string) => string): Record<AssetType, AssetConstraint> => ({
  logoNav: {
    label: t('brandingAdmin.assets.logoNav.label'),
    accept: '.svg,.png,.jpg,.jpeg,.webp',
    maxSizeKb: 1500,
    description: t('brandingAdmin.assets.logoNav.description'),
  },
  logoLoginRight: {
    label: t('brandingAdmin.assets.logoLoginRight.label'),
    accept: '.svg,.png,.jpg,.jpeg,.webp',
    maxSizeKb: 1500,
    description: t('brandingAdmin.assets.logoLoginRight.description'),
  },
  favicon: {
    label: t('brandingAdmin.assets.favicon.label'),
    accept: '.ico,.png',
    maxSizeKb: 500,
    description: t('brandingAdmin.assets.favicon.description'),
  },
});

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

const getFileValidationError = (
  t: (key: string, options?: Record<string, unknown>) => string,
  constraints: Record<AssetType, AssetConstraint>,
  type: AssetType,
  file: File,
): string | null => {
  const constraint = constraints[type];
  if (!constraint) {
    return null;
  }

  const isValidType = constraint.accept
    .split(',')
    .map((ext) => ext.trim().toLowerCase())
    .some((ext) => file.name.toLowerCase().endsWith(ext));

  if (!isValidType) {
    return t('brandingAdmin.errors.fileTypeUnsupported', { label: constraint.label });
  }
  if (file.size > constraint.maxSizeKb * 1024) {
    return t('brandingAdmin.errors.fileTooLarge', { label: constraint.label, size: constraint.maxSizeKb });
  }
  return null;
};

type BrandingAdminPanelProps = {
  onDirtyChange?: (dirty: boolean) => void;
};

const BrandingAdminPanel: React.FC<BrandingAdminPanelProps> = ({ onDirtyChange }) => {
  const { t } = useTranslation('settings');
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
  const colorGroups = useMemo(() => buildColorGroups(t), [t]);
  const assetConstraints = useMemo(() => buildAssetConstraints(t), [t]);
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
          title: t('brandingAdmin.toasts.configTitle'),
          message: (error as Error).message || t('brandingAdmin.errors.loadConfig'),
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
    showToast({ variant: 'info', message: t('brandingAdmin.toasts.resetDefault') });
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

  const renderGroupPreview = (groupId: ColorGroupId) => {
    switch (groupId) {
      case 'brandPalette':
        return (
          <div
            className="rounded-3 p-3 text-center"
            style={{ background: previewColors.primary, color: previewColors.primaryContrast }}
          >
            <div className="small text-uppercase fw-semibold">{t('brandingAdmin.colors.preview.primaryLabel')}</div>
            <div className="fw-semibold">{previewColors.primary}</div>
          </div>
        );
      case 'surfaceBackground':
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
              <div className="fw-semibold">{t('brandingAdmin.colors.preview.surfaceTitle')}</div>
              <div className="text-muted" style={{ color: previewColors.textMuted }}>
                {t('brandingAdmin.colors.preview.surfaceHint')}
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
              {t('brandingAdmin.colors.preview.pageBackground')}
            </div>
          </div>
        );
      case 'typography':
        return (
          <div className="rounded-3 border p-3" style={{ background: '#ffffff' }}>
            <h5 className="fw-semibold" style={{ color: previewColors.text }}>
              {t('brandingAdmin.colors.preview.heading')}
            </h5>
            <p className="mb-0" style={{ color: previewColors.textMuted }}>
              {t('brandingAdmin.colors.preview.typographyHint')}
            </p>
          </div>
        );
      case 'primaryButton':
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
            {t('brandingAdmin.colors.preview.primaryAction')}
          </Button>
        );
      case 'secondaryButton':
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
              {t('brandingAdmin.colors.preview.secondaryAction')}
            </Button>
            <Button variant="link" style={{ color: previewColors.buttonSecondaryText }}>
              {t('brandingAdmin.colors.preview.textLink')}
            </Button>
          </div>
        );
      default:
        return <div className="rounded-3 border p-3 text-muted">{t('brandingAdmin.colors.preview.fallback')}</div>;
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
        title: t('brandingAdmin.errors.openAssetTitle'),
        message: (error as Error).message || t('brandingAdmin.errors.openAsset'),
      });
    }
  };

  useEffect(() => {
    let cancelled = false;
    const refreshPreviews = async () => {
      const entries = await Promise.all(
        (Object.keys(assetConstraints) as AssetType[]).map(async (type) => {
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
  }, [branding.assets, getCredentials, s3Region, assetConstraints]);

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
    const validationError = getFileValidationError(t, assetConstraints, type, file);
    if (validationError) {
      showToast({ variant: 'warning', title: t('brandingAdmin.toasts.uploadBlockedTitle'), message: validationError });
      return;
    }

    if (!s3Region || !s3Bucket) {
      showToast({
        variant: 'error',
        title: `${assetConstraints[type].label}`,
        message: t('brandingAdmin.errors.missingS3Config'),
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
        title: `${assetConstraints[type].label}`,
        message: t('brandingAdmin.toasts.uploadSuccess'),
        autoHideDurationMs: 6000,
      });
    } catch (error) {
      console.error('Branding asset upload failed', {
        type,
        error,
      });
      showToast({
        variant: 'error',
        title: `${assetConstraints[type].label}`,
        message: (error as Error).message || t('brandingAdmin.errors.uploadFailed'),
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
      showToast({ variant: 'info', message: t('brandingAdmin.toasts.savingChanges') });

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
      showToast({ variant: 'success', message: t('brandingAdmin.toasts.saveSuccess') });
      sessionStorage.setItem('BRANDING_THEME_ENABLED', enabled ? 'true' : 'false');
      await loadConfig({ force: true });
      setHistoryLoaded(false);
    } catch (error) {
      showToast({
        variant: 'error',
        title: t('brandingAdmin.errors.saveTitle'),
        message: (error as Error).message || t('brandingAdmin.errors.saveFailed'),
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
    setVersionLabel(new Date().toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }));
    setShowVersionModal(true);
  };

  const previewVersion = async (versionId: string) => {
    try {
      setPreviewingVersionId(versionId);
      showToast({ variant: 'info', message: t('brandingAdmin.toasts.loadingPreview') });

      // Fetch the full version config from backend
      const versionConfig = await BrandingAdminService.fetchVersion(numaGet, versionId);

      if (!versionConfig.branding) {
        throw new Error(t('brandingAdmin.errors.versionNotFound'));
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
        title: t('brandingAdmin.toasts.previewOpenedTitle'),
        message: t('brandingAdmin.toasts.previewOpenedMessage'),
        autoHideDurationMs: 6000,
      });
    } catch (error) {
      showToast({
        variant: 'error',
        title: t('brandingAdmin.errors.previewTitle'),
        message: (error as Error).message || t('brandingAdmin.errors.previewFailed'),
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
        title: t('brandingAdmin.errors.historyTitle'),
        message: (error as Error).message || t('brandingAdmin.errors.historyFailed'),
      });
    } finally {
      setHistoryLoading(false);
    }
  }, [historyLoaded, historyLoading, numaGet, showToast]);

  const revertVersion = async (versionId: string) => {
    try {
      setSaving(true);
      showToast({ variant: 'info', message: t('brandingAdmin.toasts.restoring') });

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
      showToast({ variant: 'success', message: t('brandingAdmin.toasts.restoreSuccess') });
    } catch (error) {
      showToast({
        variant: 'error',
        title: t('brandingAdmin.errors.restoreTitle'),
        message: (error as Error).message || t('brandingAdmin.errors.restoreFailed'),
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
              <strong>{t('brandingAdmin.alerts.unsavedTitle')}</strong> {t('brandingAdmin.alerts.unsavedMessage')}
            </span>
          </div>
          <div className="d-flex gap-2">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={() => void loadConfig({ force: true })}
              disabled={saving}
            >
              {t('brandingAdmin.actions.discard')}
            </Button>
            <Button variant="warning" size="sm" onClick={() => void saveChanges()} disabled={saving}>
              {saving ? <Spinner animation="border" size="sm" /> : t('brandingAdmin.actions.saveNow')}
            </Button>
          </div>
        </Alert>
      )}

      <div>
        <div className="d-flex justify-content-between align-items-center mb-4 pt-2">
          <div>
            <h5 className="mb-1 fw-semibold">{t('brandingAdmin.title')}</h5>
            <p className="text-muted mb-0 small">{t('brandingAdmin.subtitle')}</p>
          </div>
          <Form.Check
            type="switch"
            id="branding-enabled-toggle"
            label={
              <span className="ms-2">
                {enabled ? t('brandingAdmin.toggle.enabled') : t('brandingAdmin.toggle.disabled')}
              </span>
            }
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
              {t('brandingAdmin.history.title')}
            </Accordion.Header>
            <Accordion.Body>
              {historyLoading ? (
                <div className="d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" />
                  <span>{t('brandingAdmin.history.loading')}</span>
                </div>
              ) : history.length === 0 ? (
                <div className="text-muted">{t('brandingAdmin.history.empty')}</div>
              ) : (
                <ListGroup variant="flush">
                  {history.map((item) => {
                    console.log('Version history item:', item);
                    const formattedTimestamp = item.updatedAt
                      ? new Date(item.updatedAt).toLocaleString(i18n.language, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })
                      : undefined;
                    const displayLabel = item.label || formattedTimestamp || item.versionId;
                    const metaParts: string[] = [];
                    if (formattedTimestamp && formattedTimestamp !== displayLabel) {
                      metaParts.push(formattedTimestamp);
                    }
                    metaParts.push(item.updatedBy || t('brandingAdmin.history.system'));

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
                              title={t('brandingAdmin.history.primaryColor', { color: item.primaryColor })}
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
                            title={t('brandingAdmin.history.navigationLogo')}
                          >
                            <img
                              src={item.logoNav ? toPreviewUrl(item.logoNav) : '/numa-logo.svg'}
                              alt={
                                item.logoNav
                                  ? t('brandingAdmin.history.logoAlt')
                                  : t('brandingAdmin.history.defaultLogoAlt')
                              }
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
                                {t('brandingAdmin.actions.preview')}
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
                            {t('brandingAdmin.actions.revert')}
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
              <strong>{t('brandingAdmin.disabled.title')}</strong> {t('brandingAdmin.disabled.message')}
            </div>
          </Alert>
        ) : (
          <div>
            <div className="d-flex flex-wrap gap-2 justify-content-between mb-3">
              <Button variant="secondary" size="sm" onClick={resetToDefault} disabled={saving}>
                {t('brandingAdmin.actions.resetDefault')}
              </Button>
              <div className="d-flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadConfig({ force: true })}
                  disabled={saving || !isDirty}
                >
                  {t('brandingAdmin.actions.discardChanges')}
                </Button>
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => void saveChanges()}
                  disabled={saving || !isDirty}
                >
                  {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-check-lg me-2" />}
                  {t('brandingAdmin.actions.saveChanges')}
                </Button>
                <Button variant="primary" size="sm" onClick={openVersionModal} disabled={saving || !isDirty}>
                  {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-layers me-2" />}
                  {t('brandingAdmin.actions.saveAsVersion')}
                </Button>
              </div>
            </div>

            <h6 className="fw-semibold text-uppercase text-muted small mb-3">{t('brandingAdmin.sections.colors')}</h6>
            <Row className="gy-4 align-items-start">
              <Col xs={12} xl={7}>
                <div>
                  <div className="d-flex flex-column gap-4">
                    {colorGroups.map(({ id, title, fields }) => (
                      <div key={id} className="border rounded-3 p-3">
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
                                    placeholder={t('brandingAdmin.colors.hexPlaceholder')}
                                  />
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="flex-fill">{renderGroupPreview(id)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 border-top pt-3">
                    <h6 className="fw-semibold text-uppercase text-muted small mb-3">
                      {t('brandingAdmin.sections.details')}
                    </h6>
                    <div className="d-flex flex-column gap-3">
                      <Form.Group controlId="branding-name">
                        <Form.Label>{t('brandingAdmin.details.brandName.label')}</Form.Label>
                        <Form.Control
                          type="text"
                          value={branding.name || ''}
                          onChange={handleBrandNameChange}
                          placeholder={t('brandingAdmin.details.brandName.placeholder')}
                        />
                      </Form.Group>
                      <Form.Group controlId="branding-login-title">
                        <Form.Label>{t('brandingAdmin.details.loginTitle.label')}</Form.Label>
                        <Form.Control
                          type="text"
                          value={branding.loginPage?.title || ''}
                          onChange={handleLoginUpdate('title')}
                        />
                      </Form.Group>
                      <Form.Group controlId="branding-login-message">
                        <Form.Label>{t('brandingAdmin.details.loginMessage.label')}</Form.Label>
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
                    <h6 className="fw-semibold text-uppercase text-muted small mb-3">
                      {t('brandingAdmin.sections.splash')}
                    </h6>
                    <div className="d-flex flex-column gap-3">
                      <Form.Group controlId="branding-splash-title">
                        <Form.Label>{t('brandingAdmin.splash.title.label')}</Form.Label>
                        <Form.Control
                          type="text"
                          value={branding.splashScreen?.title || ''}
                          onChange={handleSplashUpdate('title')}
                          placeholder={t('brandingAdmin.splash.title.placeholder')}
                        />
                      </Form.Group>
                      <Form.Group controlId="branding-splash-description">
                        <Form.Label>{t('brandingAdmin.splash.description.label')}</Form.Label>
                        <Form.Control
                          as="textarea"
                          rows={2}
                          value={branding.splashScreen?.description || ''}
                          onChange={handleSplashUpdate('description')}
                          placeholder={t('brandingAdmin.splash.description.placeholder')}
                        />
                      </Form.Group>
                      <Form.Group controlId="branding-splash-text-color">
                        <Form.Label>{t('brandingAdmin.splash.textColor.label')}</Form.Label>
                        <div className="d-flex align-items-center gap-2">
                          <Form.Control
                            type="color"
                            value={branding.splashScreen?.textColor || '#ffffff'}
                            onChange={handleSplashUpdate('textColor')}
                            style={{ width: '50px', height: '32px', padding: '2px' }}
                          />
                          <Form.Text className="text-muted mb-0">
                            {t('brandingAdmin.splash.textColor.default')}
                          </Form.Text>
                        </div>
                      </Form.Group>
                      <Form.Group controlId="branding-splash-show-panel">
                        <Form.Check
                          type="checkbox"
                          label={t('brandingAdmin.splash.showPanel')}
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
                      <Card.Title className="fs-6 mb-0">{t('brandingAdmin.preview.title')}</Card.Title>
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
                              {branding.name?.substring(0, 2).toUpperCase() || t('brandingAdmin.preview.brandInitials')}
                            </span>
                            <span style={{ color: previewColors.surfaceContrast, fontWeight: 600 }}>
                              {branding.name || t('brandingAdmin.preview.brandFallback')}
                            </span>
                          </div>
                          <Badge
                            bg="light"
                            text="dark"
                            style={{ border: `1px solid ${previewColors.border}`, color: previewColors.text }}
                          >
                            {t('brandingAdmin.preview.status')}
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
                          {t('brandingAdmin.preview.primaryAction')}
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
                          {t('brandingAdmin.preview.secondaryAction')}
                        </Button>
                      </div>

                      <div>
                        <h5 style={{ color: previewColors.text }}>{t('brandingAdmin.preview.sectionTitle')}</h5>
                        <p style={{ color: previewColors.textMuted }}>{t('brandingAdmin.preview.sectionBody')}</p>
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
                            {t('brandingAdmin.preview.chat.initials')}
                          </span>
                          <div className="d-flex flex-column">
                            <span className="fw-semibold" style={{ color: previewColors.text }}>
                              {t('brandingAdmin.preview.chat.assistant')}
                            </span>
                            <small className="text-muted">{t('brandingAdmin.preview.chat.status')}</small>
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
                            <p className="mb-1 fw-semibold">{t('brandingAdmin.preview.chat.assistant')}</p>
                            <p className="mb-0" style={{ color: previewColors.textMuted }}>
                              {t('brandingAdmin.preview.chat.message')}
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
                              {t('brandingAdmin.preview.chat.userMessage')}
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
                            <span>{t('brandingAdmin.preview.chat.placeholder')}</span>
                          </div>
                          <Button
                            size="sm"
                            style={{
                              background: previewColors.buttonPrimary,
                              border: `1px solid ${previewColors.buttonPrimaryBorder}`,
                              color: previewColors.buttonPrimaryText,
                            }}
                          >
                            {t('brandingAdmin.preview.chat.send')}
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
                            {t('brandingAdmin.preview.login.title')}
                          </span>
                          <Button
                            size="sm"
                            style={{
                              background: previewColors.buttonPrimary,
                              border: `1px solid ${previewColors.buttonPrimaryBorder}`,
                              color: previewColors.buttonPrimaryText,
                            }}
                          >
                            {t('brandingAdmin.preview.login.signIn')}
                          </Button>
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                </div>
              </Col>
            </Row>

            <Row className="mt-4 gy-4">
              {(Object.keys(assetConstraints) as AssetType[]).map((type) => {
                const constraint = assetConstraints[type];
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
                              <img
                                src={previewUrl}
                                alt={t('brandingAdmin.assets.previewAlt', { label: constraint.label })}
                                width={32}
                                height={32}
                              />
                            ) : (
                              <img
                                src={previewUrl}
                                alt={t('brandingAdmin.assets.previewAlt', { label: constraint.label })}
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
                                {t('brandingAdmin.assets.view')}
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
              {t('brandingAdmin.actions.discard')}
            </Button>
            <Button variant="outline-secondary" onClick={() => void saveChanges()} disabled={saving || !isDirty}>
              {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-check-lg me-2" />}
              {t('brandingAdmin.actions.saveChanges')}
            </Button>
            <Button variant="primary" onClick={openVersionModal} disabled={saving || !isDirty}>
              {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-layers me-2" />}
              {t('brandingAdmin.actions.saveAsVersion')}
            </Button>
          </div>
        )}
      </div>

      <Modal show={showVersionModal} onHide={() => setShowVersionModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('brandingAdmin.versionModal.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">{t('brandingAdmin.versionModal.description')}</p>
          <Form.Group controlId="version-label">
            <Form.Label>{t('brandingAdmin.versionModal.label')}</Form.Label>
            <Form.Control
              type="text"
              value={versionLabel}
              onChange={(e) => setVersionLabel(e.target.value)}
              placeholder={t('brandingAdmin.versionModal.placeholder')}
              autoFocus
            />
            <Form.Text className="text-muted">{t('brandingAdmin.versionModal.hint')}</Form.Text>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowVersionModal(false)}>
            {t('brandingAdmin.actions.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void handleSaveVersion()} disabled={saving}>
            {saving ? <Spinner animation="border" size="sm" /> : t('brandingAdmin.actions.saveVersion')}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showRevertModal} onHide={() => setShowRevertModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>{t('brandingAdmin.revertModal.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            {t('brandingAdmin.revertModal.confirmPrefix')}{' '}
            <strong>{revertTargetVersion?.label || revertTargetVersion?.versionId}</strong>
            {t('brandingAdmin.revertModal.confirmSuffix')}
          </p>
          <p className="text-muted mb-0">{t('brandingAdmin.revertModal.warning')}</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRevertModal(false)}>
            {t('brandingAdmin.actions.cancel')}
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
            {saving ? <Spinner animation="border" size="sm" /> : t('brandingAdmin.actions.revert')}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default BrandingAdminPanel;
