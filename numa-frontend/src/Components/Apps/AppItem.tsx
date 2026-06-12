import { StarFill, Star } from 'react-bootstrap-icons';
import { useFavorites } from '../../hooks/useFavorites';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlyingStarAnimation } from '../FlyingStarAnimation';
import { useTranslation } from 'react-i18next';
import { formatCategory } from '../../utils/textUtils';

const CATEGORY_COLORS: Record<string, string> = {
  general: '#7c3aed',
  productivity: '#9d64b5',
  finance: '#026aa2',
  compliance: '#56bcf2',
  hr: '#28a07c',
  legal: '#f59e0b',
};

const APP_ICON_MAP: Record<string, string> = {
  // Production apps
  'candidate-screening': 'bi bi-person-check',
  'contract-analysis': 'bi bi-file-earmark-text',
  'data-analysis': 'bi bi-graph-up',
  'document-summariser': 'bi bi-file-text',
  'financial-analysis': 'bi bi-currency-dollar',
  'meeting-analyser': 'bi bi-people',
  'policy-drafter': 'bi bi-pencil-square',
  'policy-reviewer': 'bi bi-shield-check',
  // Non-production apps
  'beyond-expectations': 'bi bi-star',
  'company-profile': 'bi bi-building',
  'council-resource-consents': 'bi bi-bank',
  'council-recourse-consents': 'bi bi-bank',
  'costing-calculator': 'bi bi-calculator',
  'gdsr-assessment': 'bi bi-clipboard-check',
  'infringement-review': 'bi bi-exclamation-triangle',
  nolia: 'bi bi-lightbulb',
  'nzsba-policy-builder': 'bi bi-journal-check',
  'policy-designer': 'bi bi-journal-check',
  'rfp-response-comparison': 'bi bi-files',
  'procurement-rfp-assessment': 'bi bi-cart-check',
  'structured-data-query': 'bi bi-database',
  'tor-assessment': 'bi bi-file-earmark-check',
  'e2e-test': 'bi bi-bug',
  // Example manifest / local dev apps
  'policy-builder-app': 'bi bi-file-earmark-plus',
  'meeting-tools-app': 'bi bi-camera-video',
  'loan-financing-calculator': 'bi bi-calculator',
  'data-processing-app-id': 'bi bi-cpu',
  'ml-model-deployment-app-id': 'bi bi-robot',
  'numa-workflow-app-id': 'bi bi-diagram-3',
  'meeting-tools-app-native-test': 'bi bi-camera-video',
};

const AppItem = ({ app, onCategoryClick }) => {
  const { t } = useTranslation('apps');
  const navigate = useNavigate();
  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(app.id);
  const [showAnimation, setShowAnimation] = useState(false);
  const [sourceRect, setSourceRect] = useState(null);

  const isActive = app.status === 'Active';
  const categoryColor = CATEGORY_COLORS[app.category?.toLowerCase()] || '#6b7280';

  const handleClick = () => {
    if (isActive) {
      // Data analysis is now a V2 app -- route directly to the V2 experience
      navigate(app.id === 'data-analysis' ? '/apps/v2/data-analysis' : `/app/${app.id}`);
    }
  };

  const handleFavoriteClick = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!favorite) {
      const starElement = e.currentTarget;
      setSourceRect(starElement.getBoundingClientRect());
      setShowAnimation(true);
    }

    toggleFavorite(app.id);
    if (favorite) {
      window.location.reload();
    }
  };

  const getCategoryLabel = (category) => {
    const categoryKey = String(category || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return t(`appSearch.categories.${categoryKey}`, { defaultValue: formatCategory(category) });
  };

  const statusLabel = t(`appItem.status.${String(app.status || '').toLowerCase()}`, { defaultValue: app.status });

  return (
    <>
      {showAnimation && (
        <FlyingStarAnimation
          sourceRect={sourceRect}
          targetElement={document.querySelector('.nav-component .bi-star-fill.icon')}
          onAnimationComplete={() => setShowAnimation(false)}
        />
      )}
      <div
        className={`v2-app-card ${isActive ? 'v2-app-card--active' : 'v2-app-card--coming-soon'}`}
        data-testid={`app-card-${app.id}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && handleClick()}
        title={!isActive ? t('appItem.unavailableTitle') : ''}
      >
        <div className="v2-app-card__top">
          <div className="v2-app-card__icon" style={{ backgroundColor: `${categoryColor}15` }}>
            <i
              className={APP_ICON_MAP[app.id] || 'bi bi-app-indicator'}
              style={{ color: categoryColor, fontSize: '1.25rem' }}
            />
          </div>
          <div className="v2-app-card__info">
            <h3 className="v2-app-card__name">
              {app.appName}
              {!isActive && (
                <span className="v2-status-badge v2-status-badge--coming-soon">{t('appItem.unavailable')}</span>
              )}
            </h3>
            <p className="v2-app-card__description">{app.appDescription}</p>
          </div>
        </div>
        <div className="v2-app-card__footer">
          <span className="v2-app-card__status">
            <span className="v2-app-card__status-dot" />
            {statusLabel}
          </span>
          <div className="v2-app-card__footer-right">
            {app.category && (
              <span
                className="v2-app-card__category"
                style={{ backgroundColor: `${categoryColor}15`, color: categoryColor }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onCategoryClick) onCategoryClick(app.category);
                }}
              >
                {getCategoryLabel(app.category)}
              </span>
            )}
            <span
              className="v2-app-card__favorite"
              onClick={handleFavoriteClick}
              title={favorite ? t('appItem.favorites.remove') : t('appItem.favorites.add')}
            >
              {favorite ? <StarFill className="text-warning" size={14} /> : <Star size={14} />}
            </span>
          </div>
        </div>
      </div>
    </>
  );
};

export { AppItem };
