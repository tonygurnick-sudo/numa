import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../Providers/AuthProvider';
import { resolveBrandingAssetUrl, getInitialBrandingAssetUrl } from '../utils/s3Utils';

export type UseBrandingAssetOptions = {
  sign?: boolean;
  expiresIn?: number;
  useCache?: boolean;
};

const DEFAULT_OPTIONS: Required<UseBrandingAssetOptions> = {
  sign: true,
  expiresIn: 900,
  useCache: true,
};

export const useBrandingAsset = (
  rawValue: unknown,
  fallback: string,
  options: UseBrandingAssetOptions = {},
): string => {
  const { getCredentials } = useAuth();
  const { sign, expiresIn, useCache } = { ...DEFAULT_OPTIONS, ...options };

  const initialSrc = useMemo(() => {
    if (typeof rawValue !== 'string') {
      return fallback;
    }

    return getInitialBrandingAssetUrl(rawValue, fallback, { useCache });
  }, [rawValue, fallback, useCache]);

  const [assetSrc, setAssetSrc] = useState<string>(initialSrc);

  useEffect(() => {
    if (typeof rawValue !== 'string') {
      setAssetSrc(fallback);
      return;
    }

    let cancelled = false;

    const fallbackUrl = getInitialBrandingAssetUrl(rawValue, fallback, { useCache });
    setAssetSrc(fallbackUrl);

    if (!sign) {
      return () => {
        cancelled = true;
      };
    }

    const resolveAsset = async () => {
      try {
        const resolved = await resolveBrandingAssetUrl(rawValue, getCredentials, {
          sign,
          expiresIn,
        });
        if (!cancelled && resolved) {
          setAssetSrc(resolved);
        }
      } catch (error) {
        console.error('Branding asset resolve failed', { rawValue, error });
        if (!cancelled) {
          setAssetSrc(fallbackUrl);
        }
      }
    };

    void resolveAsset();

    return () => {
      cancelled = true;
    };
  }, [rawValue, fallback, sign, expiresIn, useCache, getCredentials]);

  return assetSrc;
};
