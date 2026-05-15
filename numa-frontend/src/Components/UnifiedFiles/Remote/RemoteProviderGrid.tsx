import React from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { OAuthProviderType, OAuthProviderInfo, OAuthConnectionStatus } from '../../../types/oauthProviders';
import { ConnectorsService } from '../../../Services/ConnectorsService';

interface RemoteProviderGridProps {
  providers: OAuthProviderInfo[];
  statuses: Record<string, OAuthConnectionStatus>;
  statusLoading: Record<string, boolean>;
  viewMode: 'list' | 'grid';
  onProviderClick: (providerId: OAuthProviderType) => void;
  onRefreshStatuses: () => void;
}

export function RemoteProviderGrid({
  providers,
  statuses,
  statusLoading,
  viewMode,
  onProviderClick,
  onRefreshStatuses,
}: RemoteProviderGridProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const navigate = useNavigate();

  // Empty grid is now handled by the parent (RemoteTab) so it can render a
  // unified "go to /integrations" prompt that also accounts for Synergy.
  // Render nothing here when there are no providers — the parent decides
  // what to show in that case.
  if (providers.length === 0) return <></>;

  if (viewMode === 'grid') {
    return (
      <div className="p-3">
        <div className="row g-3">
          {providers.map((provider) => {
            const status = statuses[provider.id] ?? { status: 'disconnected' as const };
            const loading = statusLoading[provider.id];
            const connected = status.status === 'connected';
            const hasError = status.status === 'error';

            return (
              <div key={provider.id} className="col-6 col-md-4 col-lg-3">
                <div
                  className="card h-100"
                  style={{ cursor: connected ? 'pointer' : 'default' }}
                  onClick={connected ? () => onProviderClick(provider.id as OAuthProviderType) : undefined}
                >
                  <div className="card-body text-center p-3">
                    <i className={`${provider.icon}`} style={{ fontSize: '2rem', color: '#0d6efd' }} />
                    <div className="fw-semibold mt-2 text-truncate" title={provider.display_name}>
                      {provider.display_name}
                    </div>
                    <div className="mt-2">
                      {loading ? (
                        <Spinner animation="border" size="sm" variant="secondary" />
                      ) : hasError ? (
                        <div className="d-flex flex-column align-items-center gap-1">
                          <span className="text-danger small">
                            <i className="bi bi-exclamation-triangle me-1" />
                            {t('remote.tokenExpired')}
                          </span>
                          <button
                            className="btn btn-sm btn-outline-danger text-nowrap"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Reconnect lives on /integrations — single
                              // setup surface (FEAT-143).
                              navigate(`/integrations#${provider.id}`);
                            }}
                          >
                            <i className="bi bi-arrow-repeat me-1" />
                            {t('remote.reconnect')}
                          </button>
                        </div>
                      ) : connected ? (
                        <div className="d-flex align-items-center justify-content-center gap-2">
                          <span className="text-success small">
                            <i className="bi bi-check-circle me-1" />
                            {t('remote.connected')}
                          </span>
                          <button
                            className="btn btn-sm btn-outline-secondary text-nowrap"
                            onClick={(e) => {
                              e.stopPropagation();
                              ConnectorsService.disconnect(provider.id)
                                .catch(() => {})
                                .finally(() => onRefreshStatuses());
                            }}
                            title={t('remote.disconnect', 'Disconnect')}
                          >
                            <i className="bi bi-x-circle" />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // List view
  return (
    <>
      <div className="finder-columns" style={{ gridTemplateColumns: '1fr 150px 100px' }}>
        <div className="finder-col">{t('headers.name')}</div>
        <div className="finder-col">{t('headers.status')}</div>
        <div className="finder-col" />
      </div>
      <div className="finder-list">
        {providers.map((provider) => {
          const status = statuses[provider.id] ?? { status: 'disconnected' as const };
          const loading = statusLoading[provider.id];
          const connected = status.status === 'connected';
          const hasError = status.status === 'error';

          return (
            <div
              key={provider.id}
              className="finder-row"
              style={{
                gridTemplateColumns: '1fr 150px 100px',
                cursor: connected ? 'pointer' : 'default',
              }}
              onClick={connected ? () => onProviderClick(provider.id as OAuthProviderType) : undefined}
            >
              <div className="finder-row__name-content">
                <i className={`${provider.icon} finder-icon`} style={{ color: '#0d6efd' }} />
                <span className="finder-name fw-semibold">{provider.display_name}</span>
                {!loading && hasError && (
                  <button
                    className="btn btn-sm ms-2 text-nowrap btn-outline-danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Reconnect lives on /integrations — single setup
                      // surface (FEAT-143).
                      navigate(`/integrations#${provider.id}`);
                    }}
                  >
                    <i className="bi bi-arrow-repeat me-1" />
                    {t('remote.reconnect')}
                  </button>
                )}
              </div>
              <div className="finder-row__meta">
                {loading ? (
                  <Spinner animation="border" size="sm" variant="secondary" />
                ) : hasError ? (
                  <span className="text-danger small">
                    <i className="bi bi-exclamation-triangle me-1" />
                    {t('remote.tokenExpired')}
                  </span>
                ) : connected ? (
                  <span className="text-success small">
                    <i className="bi bi-check-circle me-1" />
                    {t('remote.connected')}
                  </span>
                ) : null}
              </div>
              <div className="finder-row__actions">
                {connected && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      ConnectorsService.disconnect(provider.id)
                        .catch(() => {})
                        .finally(() => onRefreshStatuses());
                    }}
                    title={t('remote.disconnect', 'Disconnect')}
                  >
                    <i className="bi bi-x-circle" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
