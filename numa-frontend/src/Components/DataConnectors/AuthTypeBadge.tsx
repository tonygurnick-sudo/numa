import { Badge } from 'react-bootstrap';
import type { ConnectorTemplate } from './connectorRegistry';

type AuthType = ConnectorTemplate['authType'];

const AUTH_TYPE_BADGE: Record<AuthType, { label: string; variant: string; title: string }> = {
  oauth2: {
    label: 'OAUTH2',
    variant: 'primary',
    title: 'Admin configures OAuth client; each user completes an OAuth consent flow.',
  },
  token: {
    label: 'PAT TOKEN',
    variant: 'info',
    title: 'Personal Access Token — each user enters their own token when first used from chat.',
  },
  'api-key': {
    label: 'API KEY',
    variant: 'info',
    title: 'Per-user API key — each user enters their own key when first used from chat.',
  },
  'username-password': {
    label: 'USERNAME/PASSWORD',
    variant: 'warning',
    title: 'Per-user credentials — each user enters their own username and password when first used from chat.',
  },
  'contact-required': {
    label: 'CONTACT REQUIRED',
    variant: 'secondary',
    title: 'This connector is not yet self-serve. Contact the vendor to enable.',
  },
};

interface AuthTypeBadgeProps {
  authType: AuthType;
  className?: string;
  size?: 'sm' | 'md';
}

export const AuthTypeBadge = ({ authType, className, size = 'sm' }: AuthTypeBadgeProps) => {
  const info = AUTH_TYPE_BADGE[authType];
  if (!info) return null;
  return (
    <Badge
      bg={info.variant}
      className={`fw-semibold text-uppercase ${className ?? ''}`}
      style={{ fontSize: size === 'sm' ? '0.65rem' : '0.75rem', letterSpacing: '0.03em' }}
      title={info.title}
    >
      {info.label}
    </Badge>
  );
};
