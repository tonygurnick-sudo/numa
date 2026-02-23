import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { useAuth } from '../Providers/AuthProvider';
import { withPRM } from '../utils/prmUtils';
import { blobCache, inflight } from '../utils/profileImageCache';

type ProfileImage = { s3Bucket: string; s3Key: string };

type ProfileAvatarProps = {
  profileImage: ProfileImage | null;
  name: string;
  email?: string;
  size?: number;
};

function getInitials(name: string, email?: string): string {
  if (name.trim()) {
    return name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }
  if (email && email.length > 0) return email[0].toUpperCase();
  return '?';
}

export const ProfileAvatar = ({ profileImage, name, email, size = 64 }: ProfileAvatarProps) => {
  const { getCredentials } = useAuth();

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const lastKeyRef = useRef<string | null>(null);

  const region = window.sessionStorage.getItem('REGION') || 'us-east-1';

  const imageKey = useMemo(() => {
    if (!profileImage?.s3Bucket || !profileImage?.s3Key) return '';
    return `${profileImage.s3Bucket}|${profileImage.s3Key}`;
  }, [profileImage]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setError(false);
      if (!imageKey) {
        setBlobUrl(null);
        lastKeyRef.current = null;
        return;
      }

      if (lastKeyRef.current === imageKey && blobUrl) return;
      lastKeyRef.current = imageKey;

      // Check cache first
      const cached = blobCache.get(imageKey);
      if (cached) {
        if (!cancelled) setBlobUrl(cached);
        return;
      }

      // Deduplicate concurrent fetches
      let promise = inflight.get(imageKey);
      if (!promise) {
        promise = (async () => {
          const credentials = await getCredentials();
          if (!credentials) throw new Error('Missing AWS credentials');
          const s3 = withPRM(S3Client, { region, credentials });
          const [bucket, key] = imageKey.split('|');
          const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
          const signedUrl = await getSignedUrl(s3, cmd, { expiresIn: 60 * 10 });
          const resp = await fetch(signedUrl);
          if (!resp.ok) throw new Error(`Failed to fetch image (${resp.status})`);
          const blob = await resp.blob();
          const url = URL.createObjectURL(blob);
          blobCache.set(imageKey, url);
          return url;
        })();
        inflight.set(imageKey, promise);
        promise.finally(() => inflight.delete(imageKey));
      }

      try {
        const url = await promise;
        if (!cancelled) setBlobUrl(url);
      } catch {
        if (!cancelled) setError(true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [getCredentials, imageKey, region]);

  const initials = useMemo(() => getInitials(name, email), [name, email]);

  const circleStyle: CSSProperties = {
    width: size,
    height: size,
    fontSize: size * 0.375,
    flexShrink: 0,
  };

  if (profileImage && blobUrl && !error) {
    return (
      <img
        src={blobUrl}
        alt={name || 'Profile'}
        className="profile-avatar-image"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div className="profile-avatar-fallback" style={circleStyle}>
      {initials}
    </div>
  );
};

export default ProfileAvatar;
