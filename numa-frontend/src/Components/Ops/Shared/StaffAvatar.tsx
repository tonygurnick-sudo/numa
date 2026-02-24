import React, { useState } from 'react';
import type { StaffProfile } from '../../../types/ops';

interface StaffAvatarProps {
  /** Full StaffProfile — or pass name/email directly */
  staff?: StaffProfile | null;
  /** Override or direct props (used when staff object is not available) */
  name?: string | null;
  email?: string;
  /** Pixel size (default 24) */
  size?: number;
}

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

/**
 * StaffAvatar renders a consistent avatar for Ops staff members.
 *
 * Uses the backend-generated presigned URL (avatarPresignedUrl) directly,
 * which avoids the cross-user S3 permission issue that occurs when the
 * frontend tries to sign URLs with the current user's scoped credentials.
 *
 * Falls back to initials when no presigned URL is available or if the
 * image fails to load.
 */
export function StaffAvatar({
  staff,
  name: nameProp,
  email: emailProp,
  size = 24,
}: StaffAvatarProps): React.JSX.Element {
  const name = staff?.name ?? nameProp ?? '';
  const email = staff?.email ?? emailProp ?? '';
  const presignedUrl = staff?.avatarPresignedUrl;
  const displayName = name || email;
  const [imgError, setImgError] = useState(false);

  if (presignedUrl && !imgError) {
    return (
      <img
        src={presignedUrl}
        alt={displayName || 'Staff'}
        className="profile-avatar-image"
        style={{ width: size, height: size }}
        onError={() => setImgError(true)}
      />
    );
  }

  return (
    <div
      className="profile-avatar-fallback"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.375,
        flexShrink: 0,
      }}
    >
      {getInitials(displayName, email)}
    </div>
  );
}
