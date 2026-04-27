import React from 'react';
import { useTranslation } from 'react-i18next';
import type { OAuthProviderType } from '../../../types/oauthProviders';
import type { SynergyBreadcrumb } from '../../../hooks/useRemoteBrowse';

interface OAuthBreadcrumb {
  label: string;
  folderId?: string;
}

interface RemoteBreadcrumbsProps {
  isInOAuthProvider: boolean;
  selectedOauthProvider: OAuthProviderType | null;
  oauthBreadcrumbs: OAuthBreadcrumb[];
  synergyConnected: boolean;
  synergyBreadcrumbs: SynergyBreadcrumb[];
  onOAuthBreadcrumbClick: (index: number) => void;
  onSynergyBreadcrumbClick: (index: number) => void;
  onResetToRoot: () => void;
  onComposeEmail: () => void;
}

export function RemoteBreadcrumbs({
  isInOAuthProvider,
  selectedOauthProvider,
  oauthBreadcrumbs,
  synergyConnected,
  synergyBreadcrumbs,
  onOAuthBreadcrumbClick,
  onSynergyBreadcrumbClick,
  onResetToRoot,
  onComposeEmail,
}: RemoteBreadcrumbsProps): React.JSX.Element | null {
  const { t } = useTranslation('files');

  const hasBreadcrumb = isInOAuthProvider || (!isInOAuthProvider && synergyConnected && synergyBreadcrumbs.length > 1);

  if (!hasBreadcrumb) return null;

  const handleUp = () => {
    if (isInOAuthProvider && oauthBreadcrumbs.length > 1) {
      onOAuthBreadcrumbClick(oauthBreadcrumbs.length - 2);
    } else if (isInOAuthProvider && oauthBreadcrumbs.length <= 1) {
      onResetToRoot();
    } else if (synergyConnected && synergyBreadcrumbs.length > 2) {
      onSynergyBreadcrumbClick(synergyBreadcrumbs.length - 2);
    } else if (synergyConnected) {
      onResetToRoot();
    }
  };

  return (
    <div className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-light" style={{ fontSize: '0.85rem' }}>
      <button className="btn btn-sm btn-outline-secondary" onClick={handleUp} title={t('toolbar.up')}>
        <i className="bi bi-arrow-up" />
      </button>

      <div className="d-flex align-items-center gap-0 flex-wrap" style={{ minWidth: 0 }}>
        {isInOAuthProvider &&
          oauthBreadcrumbs.map((crumb, i) => (
            <span key={i}>
              {i > 0 && <span className="text-muted mx-1">&rsaquo;</span>}
              <span
                className={`${i === oauthBreadcrumbs.length - 1 ? 'fw-semibold' : 'text-primary'}`}
                style={{ cursor: i < oauthBreadcrumbs.length - 1 ? 'pointer' : 'default' }}
                onClick={i < oauthBreadcrumbs.length - 1 ? () => onOAuthBreadcrumbClick(i) : undefined}
              >
                {crumb.label}
              </span>
            </span>
          ))}

        {!isInOAuthProvider &&
          synergyConnected &&
          synergyBreadcrumbs.length > 1 &&
          synergyBreadcrumbs.slice(1).map((crumb, i) => (
            <span key={i}>
              {i > 0 && <span className="text-muted mx-1">&rsaquo;</span>}
              <span
                className={`${i === synergyBreadcrumbs.length - 2 ? 'fw-semibold' : 'text-primary'}`}
                style={{ cursor: i < synergyBreadcrumbs.length - 2 ? 'pointer' : 'default' }}
                onClick={i < synergyBreadcrumbs.length - 2 ? () => onSynergyBreadcrumbClick(i + 1) : undefined}
              >
                {crumb.type === 'job' && !crumb.id ? t('remote.synergyName') : crumb.label}
              </span>
            </span>
          ))}
      </div>

      {isInOAuthProvider && selectedOauthProvider === 'gmail' && (
        <button className="btn btn-sm btn-primary ms-auto" onClick={onComposeEmail}>
          <i className="bi bi-pencil-square me-1" />
          {t('compose.title', 'Compose')}
        </button>
      )}
    </div>
  );
}
