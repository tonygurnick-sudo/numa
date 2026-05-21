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
    <nav
      aria-label={t('remote.breadcrumbsLabel', 'Breadcrumbs')}
      className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-light remote-breadcrumbs"
    >
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={handleUp}
        title={t('toolbar.up')}
        aria-label={t('toolbar.up')}
      >
        <i className="bi bi-arrow-up" aria-hidden />
      </button>

      <ol className="d-flex align-items-center gap-0 flex-wrap remote-breadcrumbs__list" style={{ minWidth: 0 }}>
        {isInOAuthProvider &&
          oauthBreadcrumbs.map((crumb, i) => {
            const isLast = i === oauthBreadcrumbs.length - 1;
            return (
              <li key={i} className="d-inline-flex align-items-center">
                {i > 0 && (
                  <span className="text-muted mx-1" aria-hidden>
                    &rsaquo;
                  </span>
                )}
                {isLast ? (
                  <span className="fw-semibold" aria-current="page">
                    {crumb.label}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0 align-baseline text-primary"
                    onClick={() => onOAuthBreadcrumbClick(i)}
                  >
                    {crumb.label}
                  </button>
                )}
              </li>
            );
          })}

        {!isInOAuthProvider &&
          synergyConnected &&
          synergyBreadcrumbs.length > 1 &&
          synergyBreadcrumbs.slice(1).map((crumb, i) => {
            const isLast = i === synergyBreadcrumbs.length - 2;
            const label = crumb.type === 'job' && !crumb.id ? t('remote.synergyName') : crumb.label;
            return (
              <li key={i} className="d-inline-flex align-items-center">
                {i > 0 && (
                  <span className="text-muted mx-1" aria-hidden>
                    &rsaquo;
                  </span>
                )}
                {isLast ? (
                  <span className="fw-semibold" aria-current="page">
                    {label}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0 align-baseline text-primary"
                    onClick={() => onSynergyBreadcrumbClick(i + 1)}
                  >
                    {label}
                  </button>
                )}
              </li>
            );
          })}
      </ol>

      {isInOAuthProvider && selectedOauthProvider === 'gmail' && (
        <button type="button" className="btn btn-sm btn-primary ms-auto" onClick={onComposeEmail}>
          <i className="bi bi-pencil-square me-1" aria-hidden />
          {t('compose.title', 'Compose')}
        </button>
      )}
    </nav>
  );
}
