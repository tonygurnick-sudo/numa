import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import {
  Accordion,
  Badge,
  Button,
  Card,
  Col,
  Form,
  ListGroup,
  OverlayTrigger,
  Row,
  Spinner,
  Tooltip,
} from 'react-bootstrap';
import {
  BrandingAdminService,
  type BrandingSavePayload,
  type BrandingVersionSummary,
} from '../../Services/BrandingAdminService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { DEFAULT_BRANDING_THEME } from '../../Providers/BrandingContext';
import type { BrandingTheme, BrandingColors } from '../../Providers/BrandingContext';
import { useAuth } from '../../Providers/AuthProvider';
import { getSignedUrlForS3Object, uploadFileToS3 } from '../../utils/s3Utils';
import { useToast } from '../../Providers/ToastContext';

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
    ],
  },
  {
    title: 'Surface & Background',
    fields: [
      { key: 'surface', label: 'Surface' },
      { key: 'surfaceContrast', label: 'Surface Contrast' },
      { key: 'border', label: 'Border' },
      { key: 'hover', label: 'Hover' },
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
      { key: 'buttonSecondaryBorder', label: 'Border' },
    ],
  },
];

const ASSET_CONSTRAINTS: Record<AssetType, AssetConstraint> = {
  logoNav: {
    label: 'Navigation Logo',
    accept: '.svg,.png,.jpg,.jpeg,.webp',
    maxSizeKb: 800,
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
    maxSizeKb: 150,
    description: 'ICO or PNG up to 150 KB. Provide multi-size favicon if available.',
  },
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
  const configClientName = sessionStorage.getItem('CLIENT_NAME') || 'numa';
  const normalizedClientName = configClientName.toLowerCase();
  const s3Region = sessionStorage.getItem('REGION') || '';
  const s3Bucket = sessionStorage.getItem('BRANDING_ASSETS_BUCKET') || `numa-${normalizedClientName}-fe`;
  const brandingPrefix = sessionStorage.getItem('BRANDING_ASSETS_PREFIX') || 'branding';
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

  const colorStyle = useMemo<CSSProperties>(() => {
    const style: CSSProperties = {};
    Object.entries(branding.colors).forEach(([key, value]) => {
      if (value) {
        (style as Record<string, string>)[`--brand-${key}`] = value;
      }
    });
    return style;
  }, [branding.colors]);

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

  const parseS3Uri = (uri: string) => {
    if (!uri?.startsWith('s3://')) {
      return null;
    }

    const withoutScheme = uri.slice('s3://'.length);
    const firstSlashIndex = withoutScheme.indexOf('/');
    if (firstSlashIndex === -1) {
      return null;
    }

    const bucket = withoutScheme.slice(0, firstSlashIndex);
    const key = withoutScheme.slice(firstSlashIndex + 1);
    return { bucket, key };
  };

  const toPreviewUrl = (uri: string) => {
    if (!s3Region) {
      return uri;
    }

    const parsed = parseS3Uri(uri);
    if (!parsed) {
      return uri;
    }

    return `https://${parsed.bucket}.s3.${s3Region}.amazonaws.com/${parsed.key}`;
  };

  const openAssetInNewTab = async (uri: string | undefined) => {
    if (!uri) {
      return;
    }

    const parsed = parseS3Uri(uri);
    if (!parsed || !s3Region) {
      window.open(toPreviewUrl(uri), '_blank');
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

          const parsed = parseS3Uri(uri);
          if (!parsed || !s3Region) {
            return [type, toPreviewUrl(uri)] as const;
          }

          try {
            const signedUrl = await getSignedUrlForS3Object(parsed.key, parsed.bucket, s3Region, getCredentials, 300);
            return [type, signedUrl] as const;
          } catch (error) {
            console.error('Failed to generate preview URL for asset', { type, error });
            return [type, toPreviewUrl(uri)] as const;
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

  const uploadAsset = async (type: AssetType, file: File) => {
    const validationError = getFileValidationError(type, file);
    if (validationError) {
      showToast({ variant: 'warning', title: 'Upload blocked', message: validationError });
      return;
    }

    try {
      setUploading((prev) => ({ ...prev, [type]: true }));

      if (!s3Bucket || !s3Region) {
        throw new Error('Branding asset bucket or region is not configured.');
      }

      const sanitizedName = file.name.replace(/\s+/g, '-');
      const key = `${brandingPrefix}/${type}/${Date.now()}-${sanitizedName}`;
      const arrayBuffer = await file.arrayBuffer();

      const assetUri = await uploadFileToS3(arrayBuffer, file.type, s3Bucket, key, s3Region, getCredentials);

      applyAssetUrl(type, assetUri);
      showToast({
        variant: 'success',
        title: `${ASSET_CONSTRAINTS[type].label}`,
        message: 'Uploaded successfully. Remember to save changes to apply.',
        autoHideDurationMs: 6000,
      });
    } catch (error) {
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

  const saveChanges = async (options?: { createVersion?: boolean }) => {
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
      };

      await BrandingAdminService.saveConfig(numaPut, payload);
      showToast({ variant: 'success', message: 'Branding settings saved successfully.' });
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
      setEnabled(Boolean(result.enabled));
      setBranding(mergeBranding(result.branding));
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
      <Card className="border-0 shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <Card.Title className="mb-1">Branding Controls</Card.Title>
              <Card.Subtitle className="text-muted">
                Manage tenant branding, colors, and assets. Changes publish immediately after saving.
              </Card.Subtitle>
            </div>
            <Form.Check
              type="switch"
              id="branding-enabled-toggle"
              label={enabled ? 'Branding enabled' : 'Branding disabled'}
              checked={enabled}
              onChange={(event) => {
                markDirty();
                setEnabled(event.target.checked);
              }}
            />
          </div>

          <div className="d-flex flex-wrap gap-2 justify-content-end mb-3">
            <Button variant="outline-secondary" size="sm" onClick={resetToDefault} disabled={saving}>
              Reset to Default
            </Button>
          </div>

          <Row className="gy-4">
            <Col xs={12}>
              <Card className="h-100">
                <Card.Body>
                  <Card.Title className="fs-6">Color Palette</Card.Title>
                  <Row className="g-4">
                    {COLOR_GROUPS.map(({ title, fields }) => (
                      <Col key={title} xs={12} md={6} lg={4}>
                        <div className="d-flex flex-column gap-3 h-100">
                          <div className="border-bottom pb-1">
                            <span className="text-uppercase text-muted small fw-semibold">{title}</span>
                          </div>
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
                      </Col>
                    ))}
                  </Row>

                  <div className="mt-4 border-top pt-3">
                    <Card.Title className="fs-6 mb-3">Branding Details</Card.Title>
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
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12}>
              <Card className="h-100" style={colorStyle}>
                <Card.Body>
                  <Card.Title className="fs-6 mb-3">Live Preview</Card.Title>
                  <Row className="g-3">
                    <Col xs={12} lg={6}>
                      <div className="d-flex flex-column gap-3 h-100">
                        <div
                          className="rounded-3 p-3"
                          style={{
                            background: 'var(--brand-surface)',
                            border: '1px solid var(--brand-border)',
                          }}
                        >
                          <div className="d-flex justify-content-between align-items-center">
                            <div className="d-flex align-items-center gap-2">
                              {branding.logo && (
                                <span
                                  className="rounded-circle d-inline-flex align-items-center justify-content-center"
                                  style={{
                                    width: '40px',
                                    height: '40px',
                                    background: 'var(--brand-primary)',
                                    color: 'var(--brand-primaryContrast)',
                                    fontWeight: 600,
                                  }}
                                >
                                  {branding.name?.substring(0, 2).toUpperCase() || 'BR'}
                                </span>
                              )}
                              <span style={{ color: 'var(--brand-surfaceContrast)', fontWeight: 600 }}>
                                {branding.name || 'Brand'}
                              </span>
                            </div>
                            <Badge bg="light" text="dark">
                              Active
                            </Badge>
                          </div>
                        </div>

                        <div className="d-flex gap-2">
                          <Button
                            style={{
                              background: 'var(--brand-buttonPrimary)',
                              border: '1px solid var(--brand-buttonPrimaryBorder)',
                              color: 'var(--brand-buttonPrimaryText)',
                            }}
                          >
                            Primary Action
                          </Button>
                          <Button
                            variant="outline-primary"
                            style={{
                              background: 'var(--brand-surface)',
                              color: 'var(--brand-buttonSecondaryText)',
                              borderColor: 'var(--brand-buttonSecondaryBorder)',
                            }}
                          >
                            Secondary Action
                          </Button>
                        </div>

                        <div>
                          <h5 style={{ color: 'var(--brand-text)' }}>Section Header</h5>
                          <p style={{ color: 'var(--brand-textMuted)' }}>
                            Supporting copy uses muted text color for hierarchy and readability.
                          </p>
                        </div>

                        <div
                          className="rounded-4 p-3 d-flex flex-column gap-3 h-100"
                          style={{
                            border: '1px solid var(--brand-border)',
                            background: 'var(--brand-background)',
                          }}
                        >
                          <div className="d-flex align-items-center gap-2">
                            <span
                              className="rounded-circle d-inline-flex align-items-center justify-content-center"
                              style={{
                                width: '36px',
                                height: '36px',
                                background: 'var(--brand-primary)',
                                color: 'var(--brand-primaryContrast)',
                                fontWeight: 600,
                              }}
                            >
                              N
                            </span>
                            <div className="d-flex flex-column">
                              <span className="fw-semibold" style={{ color: 'var(--brand-text)' }}>
                                Numa Assistant
                              </span>
                              <small className="text-muted">Online</small>
                            </div>
                          </div>

                          <div className="d-flex flex-column gap-3">
                            <div
                              className="rounded-4 p-3 align-self-start"
                              style={{
                                background: 'var(--brand-surface)',
                                color: 'var(--brand-surfaceContrast)',
                                maxWidth: '85%',
                              }}
                            >
                              <p className="mb-1 fw-semibold">Numa Assistant</p>
                              <p className="mb-0" style={{ color: 'var(--brand-textMuted)' }}>
                                Hi! I can help you with onboarding, training resources, or account updates. What would
                                you like to do today?
                              </p>
                            </div>

                            <div className="d-flex justify-content-end">
                              <div
                                className="rounded-4 p-3"
                                style={{
                                  background: 'var(--bg-message-user)',
                                  color: 'var(--brand-text)',
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
                            style={{ borderColor: 'var(--brand-border)' }}
                          >
                            <div
                              className="flex-grow-1 rounded-pill px-3 py-2 d-flex align-items-center gap-2"
                              style={{
                                background: 'var(--brand-surface)',
                                border: '1px solid var(--brand-border)',
                                color: 'var(--brand-textMuted)',
                              }}
                            >
                              <i className="bi bi-send" style={{ color: 'var(--brand-textMuted)' }}></i>
                              <span>Type a message…</span>
                            </div>
                            <Button
                              size="sm"
                              style={{
                                background: 'var(--brand-buttonPrimary)',
                                border: '1px solid var(--brand-buttonPrimaryBorder)',
                                color: 'var(--brand-buttonPrimaryText)',
                              }}
                            >
                              Send
                            </Button>
                          </div>
                        </div>
                      </div>
                    </Col>

                    <Col xs={12} lg={6}>
                      <div
                        className="rounded-3 p-4 h-100"
                        style={{
                          border: '1px dashed var(--brand-border)',
                          background: 'var(--brand-background)',
                        }}
                      >
                        <div className="d-flex flex-column gap-2 text-center">
                          <span className="fw-semibold" style={{ color: 'var(--brand-text)' }}>
                            Login Preview
                          </span>
                          <Button
                            size="sm"
                            style={{
                              background: 'var(--brand-buttonPrimary)',
                              border: '1px solid var(--brand-buttonPrimaryBorder)',
                              color: 'var(--brand-buttonPrimaryText)',
                            }}
                          >
                            Sign in
                          </Button>
                        </div>
                      </div>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
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
        </Card.Body>
        <Card.Footer className="d-flex justify-content-end gap-2">
          <Button
            variant="outline-secondary"
            onClick={() => void loadConfig({ force: true })}
            disabled={saving || !isDirty}
          >
            Discard Changes
          </Button>
          <Button
            variant="outline-primary"
            onClick={() => void saveChanges({ createVersion: true })}
            disabled={saving || !isDirty}
          >
            {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-layers me-2" />}
            Save as New Version
          </Button>
          <Button variant="primary" onClick={() => void saveChanges()} disabled={saving || !isDirty}>
            {saving ? <Spinner animation="border" size="sm" /> : <i className="bi bi-check-lg me-2" />}
            Save Changes
          </Button>
        </Card.Footer>
      </Card>
      <Accordion alwaysOpen={false} flush>
        <Accordion.Item eventKey="history">
          <Accordion.Header
            onClick={() => {
              void fetchHistoryIfNeeded();
            }}
          >
            Version History
          </Accordion.Header>
          <Accordion.Body>
            {historyLoading ? (
              <div className="d-flex align-items-center gap-2">
                <Spinner animation="border" size="sm" />
                <span>Loading versions…</span>
              </div>
            ) : history.length === 0 ? (
              <div className="text-muted">No published versions yet.</div>
            ) : (
              <ListGroup variant="flush">
                {history.map((item) => {
                  const formattedTimestamp = item.updatedAt
                    ? new Date(item.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                    : undefined;
                  const displayLabel = item.label || formattedTimestamp || item.versionId;
                  const metaParts: string[] = [];
                  if (formattedTimestamp && formattedTimestamp !== displayLabel) {
                    metaParts.push(formattedTimestamp);
                  }
                  metaParts.push(item.updatedBy || 'system');
                  if (item.versionId) {
                    metaParts.push(item.versionId);
                  }

                  return (
                    <ListGroup.Item key={item.versionId} className="d-flex justify-content-between align-items-center">
                      <div>
                        <div className="fw-semibold">{displayLabel}</div>
                        <div className="small text-muted">{metaParts.join(' · ')}</div>
                      </div>
                      <Button
                        variant="outline-primary"
                        size="sm"
                        onClick={() => revertVersion(item.versionId)}
                        disabled={saving}
                      >
                        Revert
                      </Button>
                    </ListGroup.Item>
                  );
                })}
              </ListGroup>
            )}
          </Accordion.Body>
        </Accordion.Item>
      </Accordion>
    </div>
  );
};

export default BrandingAdminPanel;
