import React from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { OAuthProviderType, OAuthProviderInfo, OAuthConnectionStatus } from '../../../types/oauthProviders';
import { OAuthProvidersService } from '../../../Services/internal/OAuthProvidersService';

interface RemoteProviderGridProps {
  providers: OAuthProviderInfo[];
  statuses: Record<string, OAuthConnectionStatus>;
  statusLoading: Record<string, boolean>;
  connectingProvider: OAuthProviderType | null;
  connecting: boolean;
  viewMode: 'list' | 'grid';
  onProviderClick: (providerId: OAuthProviderType) => void;
  onConnect: (providerId: OAuthProviderType) => void;
  onRefreshStatuses: () => void;
}

export function RemoteProviderGrid({
  providers,
  statuses,
  statusLoading,
  connectingProvider,
  connecting,
  viewMode,
  onProviderClick,
  onConnect,
  onRefreshStatuses,
}: RemoteProviderGridProps): React.JSX.Element {
  const { t } = useTranslation('files');

  if (providers.length === 0) {
    return (
      <div className="finder-empty" style={{ padding: '3rem' }}>
        <i className="bi bi-cloud" style={{ fontSize: '2rem', color: '#86868b' }} />
        <h6 className="mt-2">{t('remote.noProviders', 'No providers configured')}</h6>
        <p className="text-muted small">
          {t('remote.noProvidersMessage', 'Enable data connectors to browse remote files.')}
        </p>
      </div>
    );
  }

  if (viewMode === 'grid') {
    return (
      <div className="p-3">
        <div className="row g-3">
          {providers.map((provider) => {
            const status = statuses[provider.id] ?? { status: 'disconnected' as const };
            const loading = statusLoading[provider.id];
            const isConnecting = connectingProvider === provider.id;
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
                              onConnect(provider.id as OAuthProviderType);
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
                              OAuthProvidersService.disconnect(provider.id)
                                .catch(() => {})
                                .finally(() => onRefreshStatuses());
                            }}
                            title={t('remote.disconnect', 'Disconnect')}
                          >
                            <i className="bi bi-x-circle" />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-sm btn-primary text-nowrap"
                          onClick={(e) => {
                            e.stopPropagation();
                            onConnect(provider.id as OAuthProviderType);
                          }}
                          disabled={connecting}
                        >
                          {isConnecting ? (
                            <>
                              <Spinner animation="border" size="sm" className="me-1" />
                              {t('remote.connecting')}
                            </>
                          ) : (
                            <>
                              <i className="bi bi-plug me-1" />
                              {t('remote.connect')}
                            </>
                          )}
                        </button>
                      )}
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
          const isConnecting = connectingProvider === provider.id;
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
                {!loading && !connected && (
                  <button
                    className={`btn btn-sm ms-2 text-nowrap ${hasError ? 'btn-outline-danger' : 'btn-primary'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onConnect(provider.id as OAuthProviderType);
                    }}
                    disabled={connecting}
                  >
                    {isConnecting ? (
                      <>
                        <Spinner animation="border" size="sm" className="me-1" />
                        {t('remote.connecting')}
                      </>
                    ) : hasError ? (
                      <>
                        <i className="bi bi-arrow-repeat me-1" />
                        {t('remote.reconnect')}
                      </>
                    ) : (
                      <>
                        <i className="bi bi-plug me-1" />
                        {t('remote.connect')}
                      </>
                    )}
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
                      OAuthProvidersService.disconnect(provider.id)
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
