import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { V2AppConfig } from '../../types/apps';

interface V2AppCardProps {
  app: V2AppConfig;
}

export const V2AppCard: React.FC<V2AppCardProps> = ({ app }) => {
  const { t } = useTranslation('apps');
  const navigate = useNavigate();
  const Icon = app.icon;

  const handleClick = () => {
    if (app.status !== 'coming-soon') {
      navigate(`/apps/v2/${app.id}`);
    }
  };

  return (
    <div
      className={`v2-app-card v2-app-card--${app.status}`}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && handleClick()}
    >
      <div className="v2-app-card__top">
        <div className="v2-app-card__icon" style={{ backgroundColor: `${app.color}15` }}>
          <Icon size={20} style={{ color: app.color }} />
        </div>
        <div className="v2-app-card__info">
          <h3 className="v2-app-card__name">
            {t(app.nameKey)}
            {app.status === 'beta' && (
              <span className="v2-status-badge v2-status-badge--beta">{t('v2Apps.card.status.beta')}</span>
            )}
            {app.status === 'coming-soon' && (
              <span className="v2-status-badge v2-status-badge--coming-soon">
                {t('v2Apps.card.status.coming-soon')}
              </span>
            )}
          </h3>
          <p className="v2-app-card__description">{t(app.descriptionKey)}</p>
        </div>
      </div>
      <div className="v2-app-card__footer">
        <span className="v2-app-card__status">
          <span className="v2-app-card__status-dot" />
          {t(`v2Apps.card.status.${app.status}`)}
        </span>
        <span
          className="v2-app-card__category"
          style={{
            backgroundColor: `${app.color}15`,
            color: app.color,
          }}
        >
          {t(`appSearch.categories.${app.category}`, { defaultValue: app.category })}
        </span>
      </div>
    </div>
  );
};
