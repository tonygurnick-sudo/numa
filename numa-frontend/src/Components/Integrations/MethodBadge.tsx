import { Zap, Plug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IntegrationMethod } from '../../Services/AdminIntegrationsService';

type MethodBadgeProps = {
  method: IntegrationMethod;
  size?: 'sm' | 'xs';
};

/**
 * Pill badge that tells the user whether an integration is wired through
 * Numa's native connectors or via Pipedream. Always visible on every card —
 * the underlying method shouldn't matter to most users, but a small label
 * keeps it scannable for admins and support.
 */
export const MethodBadge = ({ method, size = 'sm' }: MethodBadgeProps) => {
  const { t } = useTranslation('integrations');
  const isNative = method === 'native';
  const Icon = isNative ? Plug : Zap;
  const label = isNative ? t('methodBadge.native', 'Native') : t('methodBadge.pipedream', 'Pipedream');

  // Solid pill for Native (first-party — we own the OAuth client and the
  // direct vault); soft outlined pill for Pipedream (third-party-managed via
  // shared OAuth app). The visual hierarchy reflects which side is "Numa's
  // own thing" vs. delegated.
  const className = isNative
    ? 'bg-primary text-white border border-primary'
    : 'bg-secondary-subtle text-secondary-emphasis border border-secondary-subtle';

  const fontSize = size === 'xs' ? '0.7rem' : '0.75rem';
  const padding = size === 'xs' ? '0.15rem 0.5rem' : '0.2rem 0.6rem';
  const iconSize = size === 'xs' ? 11 : 12;

  return (
    <span
      className={`badge ${className}`}
      style={{
        fontSize,
        padding,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        fontWeight: 500,
        letterSpacing: '0.01em',
        lineHeight: 1.2,
        verticalAlign: 'middle',
      }}
      title={
        isNative
          ? t('methodBadge.nativeTooltip', 'Connected via Numa native connector')
          : t('methodBadge.pipedreamTooltip', 'Connected via Pipedream')
      }
    >
      <Icon size={iconSize} strokeWidth={2.25} aria-hidden style={{ flexShrink: 0 }} />
      <span>{label}</span>
    </span>
  );
};
