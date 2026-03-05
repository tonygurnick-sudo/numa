import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useAuth } from '../../Providers/AuthProvider';
import type { AgentSummary } from '../../types/agents';
import { AGENT_ICON_CATALOG } from '../../config/agentIconCatalog';
import AgentAvatar from './AgentAvatar';
import { withPRM } from '../../utils/prmUtils';

type IconImage = { s3Bucket: string; s3Key: string };

type AgentAvatarSelectorValue = {
  icon?: string;
  iconImage?: IconImage | null;
};

type AgentAvatarSelectorProps = {
  value?: AgentAvatarSelectorValue;
  onChange: (value: AgentAvatarSelectorValue) => void;
  disabled?: boolean;
  previewAgent?: AgentSummary | null;
};

const MAX_BYTES = 1 * 1024 * 1024; // 1 MB
const TARGET_SIZE = 256; // 256x256

export const AgentAvatarSelector = ({ value, onChange, disabled = false, previewAgent }: AgentAvatarSelectorProps) => {
  const { t } = useTranslation('agents');
  const [activeTab, setActiveTab] = useState<'icons' | 'upload'>('icons');
  const [bucketName, setBucketName] = useState<string | undefined>();
  const [region, setRegion] = useState<string | undefined>();
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { getCredentials, user } = useAuth();

  const currentValue = useMemo(() => value || {}, [value]);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/config.json');
        if (!response.ok) throw new Error(`Failed to load config.json (${response.status})`);
        const config = await response.json();
        setBucketName(`numa-${config.CLIENT_NAME}-outputs`);
        setRegion(config.REGION);
      } catch {
        const clientName = window.sessionStorage.getItem('CLIENT_NAME') || undefined;
        const sessionRegion = window.sessionStorage.getItem('REGION') || undefined;
        if (clientName) setBucketName(`numa-${clientName}-outputs`);
        if (sessionRegion) setRegion(sessionRegion);
      }
    };
    loadConfig();
  }, []);

  const resizeToCanvas = useCallback(
    async (file: File): Promise<Blob> => {
      const url = URL.createObjectURL(file);
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error(t('avatarSelector.errors.imageLoad')));
          image.src = url;
        });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error(t('avatarSelector.errors.canvas'));
        canvas.width = TARGET_SIZE;
        canvas.height = TARGET_SIZE;

        // cover fit
        const scale = Math.max(TARGET_SIZE / img.width, TARGET_SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const dx = (TARGET_SIZE - w) / 2;
        const dy = (TARGET_SIZE - h) / 2;

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE);
        ctx.drawImage(img, dx, dy, w, h);
        return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b || new Blob()), 'image/png'));
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [t]
  );

  const handleUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = (event.target.files && event.target.files[0]) || null;
      if (!file) return;
      setError(null);
      if (!bucketName || !region) {
        setError(t('avatarSelector.errors.configLoading'));
        return;
      }
      if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
        setError(t('avatarSelector.errors.invalidType'));
        return;
      }
      setIsUploading(true);
      try {
        const blob = await resizeToCanvas(file);
        const finalBlob = blob.size > MAX_BYTES ? await resizeToCanvas(file) : blob; // re-run if needed
        const ext = 'png';
        const userId =
          (user?.decoded_tokens?.idToken?.sub as string | undefined) ||
          window.sessionStorage.getItem('USER_ID') ||
          'anonymous';
        const randomId = Math.random().toString(36).slice(2, 10);
        const s3Key = `numa-chat/agent-icons/${userId}/${Date.now()}_${randomId}.${ext}`;

        const credentials = await getCredentials();
        if (!credentials) throw new Error(t('avatarSelector.errors.credentials'));
        const s3 = withPRM(S3Client, { region, credentials });
        const put = new PutObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
          ContentType: 'image/png',
          CacheControl: 'public, max-age=31536000, immutable',
        });
        const url = await getSignedUrl(s3, put, { expiresIn: 60 * 10 });
        await axios.put(url, finalBlob, { headers: { 'Content-Type': 'image/png' } });

        onChange({ icon: undefined, iconImage: { s3Bucket: bucketName, s3Key } });
        setActiveTab('icons');
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (e) {
        setError((e as Error)?.message || t('avatarSelector.errors.uploadFailed'));
      } finally {
        setIsUploading(false);
      }
    },
    [bucketName, getCredentials, onChange, region, resizeToCanvas, t]
  );

  const clearImage = useCallback(
    () => onChange({ icon: currentValue.icon || 'bi bi-robot', iconImage: null }),
    [currentValue.icon, onChange]
  );

  return (
    <div className="border rounded-3 bg-white">
      <div
        className="p-3 d-flex align-items-center justify-content-between"
        style={{ borderBottom: '1px solid #e0e0e0' }}
      >
        <div className="d-flex align-items-center gap-3">
          <AgentAvatar
            agent={previewAgent || undefined}
            icon={currentValue.icon}
            iconImage={currentValue.iconImage}
            size={56}
            fit="contain"
            alt={t('avatarSelector.previewAlt')}
          />
          <div>
            <div className="fw-semibold">
              {currentValue.iconImage
                ? t('avatarSelector.current.customImage')
                : AGENT_ICON_CATALOG.find((i) => i.value === currentValue.icon)?.label ||
                  t('avatarSelector.current.icon')}
            </div>
            <small className="text-muted">
              {currentValue.iconImage
                ? t('avatarSelector.current.uploadedCustom')
                : t('avatarSelector.current.selectOrUpload')}
            </small>
          </div>
        </div>
        {currentValue.iconImage && (
          <Button variant="outline-danger" size="sm" onClick={clearImage} disabled={disabled || isUploading}>
            <i className="bi bi-trash me-1"></i> {t('avatarSelector.actions.remove')}
          </Button>
        )}
      </div>

      <div className="p-3">
        <div className="d-flex gap-2 mb-3">
          <Button
            type="button"
            variant={activeTab === 'icons' ? 'primary' : 'outline-secondary'}
            className="flex-fill d-flex align-items-center justify-content-center gap-2"
            aria-pressed={activeTab === 'icons'}
            onClick={() => setActiveTab('icons')}
          >
            <i className="bi bi-grid-3x3-gap"></i>
            {t('avatarSelector.tabs.chooseIcon')}
          </Button>
          <Button
            type="button"
            variant={activeTab === 'upload' ? 'primary' : 'outline-secondary'}
            className="flex-fill d-flex align-items-center justify-content-center gap-2"
            aria-pressed={activeTab === 'upload'}
            onClick={() => setActiveTab('upload')}
          >
            <i className="bi bi-upload"></i>
            {t('avatarSelector.tabs.uploadImage')}
          </Button>
        </div>

        {activeTab === 'icons' ? (
          <div className="d-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(44px, 1fr))', gap: 6 }}>
            {AGENT_ICON_CATALOG.map((opt) => {
              const isActive = currentValue.icon === opt.value && !currentValue.iconImage;
              return (
                <Button
                  key={opt.value}
                  variant={isActive ? 'primary' : 'outline-secondary'}
                  size="sm"
                  onClick={() => onChange({ icon: opt.value, iconImage: null })}
                  aria-pressed={isActive}
                  title={opt.label}
                  style={{
                    aspectRatio: '1',
                    padding: '0.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <i className={opt.value} style={{ fontSize: '1.25rem' }} />
                </Button>
              );
            })}
          </div>
        ) : (
          <div className="p-3 rounded-3 bg-light">
            <div className="mb-3">
              <small className="text-muted d-block">
                <i className="bi bi-info-circle me-1"></i>
                {t('avatarSelector.upload.helper')}
              </small>
            </div>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/png,image/jpeg"
              style={{ display: 'none' }}
              onChange={handleUpload}
              disabled={disabled || isUploading}
            />
            <Button
              type="button"
              variant="primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || isUploading}
              className="w-100 d-flex align-items-center justify-content-center gap-2"
              style={{ minHeight: '44px', fontWeight: 500 }}
            >
              {isUploading ? (
                <>
                  <Spinner animation="border" size="sm" style={{ width: '1rem', height: '1rem' }} />
                  <span style={{ lineHeight: '1' }}>{t('avatarSelector.upload.uploading')}</span>
                </>
              ) : (
                <>
                  <i className="bi bi-upload" style={{ fontSize: '1rem' }} />
                  <span style={{ lineHeight: '1' }}>{t('avatarSelector.upload.chooseFile')}</span>
                </>
              )}
            </Button>
            {error && (
              <div className="alert alert-danger mb-0 py-2 mt-3">
                <i className="bi bi-exclamation-triangle me-2"></i>
                {error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentAvatarSelector;
