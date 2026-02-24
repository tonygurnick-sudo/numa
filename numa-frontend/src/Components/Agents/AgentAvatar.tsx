import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Bot } from 'lucide-react';
import type { AgentSummary } from '../../types/agents';
import { useAuth } from '../../Providers/AuthProvider';
import { withPRM } from '../../utils/prmUtils';

type IconImage = { s3Bucket: string; s3Key: string };

type AgentAvatarProps = {
  agent?: AgentSummary | null;
  icon?: string;
  iconImage?: IconImage;
  size?: number; // px
  className?: string;
  style?: CSSProperties;
  rounded?: boolean;
  alt?: string;
  fit?: 'cover' | 'contain';
};

const DEFAULT_ICON = 'bi bi-robot';

// Simple in-memory cache for signed URLs to avoid re-signing and re-downloading.
// Keyed by `${bucket}|${key}`.
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const inflight = new Map<string, Promise<string>>();

export const AgentAvatar = ({
  agent,
  icon,
  iconImage,
  size = 48,
  className,
  style,
  rounded = true,
  alt,
  fit = 'cover',
}: AgentAvatarProps) => {
  const { t } = useTranslation('agents');
  const { getCredentials } = useAuth();

  const effectiveIconImage = useMemo<IconImage | undefined>(() => {
    if (iconImage?.s3Bucket && iconImage?.s3Key) return iconImage;
    if (agent?.iconImage?.s3Bucket && agent?.iconImage?.s3Key) return agent.iconImage;
    return undefined;
  }, [agent, iconImage]);

  const effectiveIconClass = useMemo(() => {
    return icon || agent?.icon || DEFAULT_ICON;
  }, [agent, icon]);

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastKeyRef = useRef<string | null>(null);

  const [resolvedRegion, setResolvedRegion] = useState<string>(window.sessionStorage.getItem('REGION') || '');

  useEffect(() => {
    if (resolvedRegion) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/config.json');
        if (resp.ok) {
          const cfg = await resp.json();
          if (!cancelled && cfg?.REGION) setResolvedRegion(cfg.REGION as string);
        }
      } catch {
        // noop
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [resolvedRegion]);

  const imageKey = useMemo(() => {
    if (!effectiveIconImage) return '';
    return `${effectiveIconImage.s3Bucket}|${effectiveIconImage.s3Key}`;
  }, [effectiveIconImage]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(null);
      if (!imageKey) return;

      // If key did not change, do nothing.
      if (lastKeyRef.current === imageKey && imageUrl) return;
      lastKeyRef.current = imageKey;

      // Try cache first
      const cached = urlCache.get(imageKey);
      const now = Date.now();
      if (cached && cached.expiresAt > now) {
        if (!cancelled) setImageUrl(cached.url);
        return;
      }

      // Deduplicate concurrent signings
      let promise = inflight.get(imageKey);
      if (!promise) {
        promise = (async () => {
          const credentials = await getCredentials();
          if (!credentials) throw new Error('Missing AWS credentials');
          const s3 = withPRM(S3Client, { region: resolvedRegion || undefined, credentials });
          const [bucket, key] = imageKey.split('|');
          const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
          const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 10 }); // 10 minutes
          // Cache for ~9 minutes to be safe
          urlCache.set(imageKey, { url, expiresAt: now + 9 * 60 * 1000 });
          return url;
        })();
        inflight.set(imageKey, promise);
        // Clean inflight after settle
        promise.finally(() => inflight.delete(imageKey));
      }
      try {
        const url = await promise;
        if (!cancelled) setImageUrl(url);
      } catch (e) {
        if (!cancelled) setError((e as Error)?.message || 'Failed to load image');
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [getCredentials, imageKey, resolvedRegion]);

  const dimensionStyle: CSSProperties = useMemo(
    () => ({ width: size, height: size, flexShrink: 0, ...style }),
    [size, style],
  );
  const resolvedAlt = alt || agent?.title || t('avatar.defaultAlt');

  if (effectiveIconImage && imageUrl && !error) {
    return (
      <img
        src={imageUrl}
        alt={resolvedAlt}
        className={className}
        loading="lazy"
        decoding="async"
        style={{
          ...dimensionStyle,
          objectFit: fit,
          objectPosition: 'center center',
          borderRadius: rounded ? 8 : 0,
          border: '1px solid rgba(0,0,0,0.1)',
          backgroundColor: '#f8f9fa',
        }}
      />
    );
  }

  return (
    <div
      className={`${className || ''} d-flex align-items-center justify-content-center bg-light border`}
      style={{
        ...dimensionStyle,
        borderRadius: rounded ? 8 : 0,
      }}
      aria-label={resolvedAlt}
    >
      {effectiveIconClass === DEFAULT_ICON ? (
        <Bot size={Math.round(size * 0.6)} style={{ color: 'var(--brand-primary, var(--color-primary))' }} />
      ) : (
        <i
          className={effectiveIconClass}
          style={{ fontSize: Math.round(size * 0.6), color: 'var(--brand-primary, var(--color-primary))' }}
        />
      )}
    </div>
  );
};

export default AgentAvatar;
