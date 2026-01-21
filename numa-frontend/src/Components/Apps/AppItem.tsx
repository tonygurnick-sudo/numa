import { Preloader } from '../Preloader';
import { StarFill, Star } from 'react-bootstrap-icons';
import { useFavorites } from '../../hooks/useFavorites';
import { useState } from 'react';
import { FlyingStarAnimation } from '../FlyingStarAnimation';
import { useTranslation } from 'react-i18next';

const AppItem = ({ app, onCategoryClick }) => {
  const { t } = useTranslation('apps');
  // Get first 3 tags for display
  const displayTags = app?.tags?.slice(0, 3) || [];

  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(app.id);
  const [showAnimation, setShowAnimation] = useState(false);
  const [sourceRect, setSourceRect] = useState(null);

  const handleFavoriteClick = (e) => {
    e.preventDefault(); // Prevent card click from triggering

    // Only animate when adding to favorites, not removing
    if (!favorite) {
      // Get the source position for the animation
      const starElement = e.currentTarget;
      setSourceRect(starElement.getBoundingClientRect());
      setShowAnimation(true);
    }

    toggleFavorite(app.id);
    if (favorite) {
      // navigate('/favourite-apps');
      window.location.reload();
    }
  };

  // Format the app name to be more visually appealing
  const formatAppName = (name) => {
    if (!name) return '';
    return name;
  };

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
        className={`card card-apps w-100 ${app.status !== 'Active' ? 'card-disabled' : ''}`}
        data-testid={`app-card-${app.id}`}
        title={app.status !== 'Active' ? t('appItem.unavailableTitle') : ''}
        data-tooltip-delay="500"
      >
        <div className="card-header">
          <div className="app-name">
            <a href={`/app/${app.id}`} rel="noopener">
              {formatAppName(app?.appName)}
            </a>
          </div>

          <div className="app-meta">
            {app?.category && (
              <div
                className={`category-pill ${app.category.toLowerCase()}`}
                onClick={(e) => {
                  e.preventDefault(); // Prevent card click
                  if (onCategoryClick) {
                    onCategoryClick(app.category);
                  }
                }}
                style={{ cursor: 'pointer' }}
                title={t('appItem.filterByCategory', { category: app.category })}
              >
                {app.category.toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase())}
              </div>
            )}
          </div>
        </div>

        <div className="card-body">
          <div className="app-info">
            <div className="app-description">
              {app.appDescription === t('appItem.loading') ? (
                <Preloader smallscreen={true} />
              ) : (
                <div className="description-text">{app.appDescription}</div>
              )}
            </div>
            <div className="app-tags">
              {displayTags.map((tag, index) => (
                <span
                  key={index}
                  className={`tag-pill tag-${['green', 'purple', 'blue', 'orange', 'teal'][index % 5]}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
        <div className="card-footer">
          <div className="footer-content">
            <div className="footer-left">
              <div className="d-flex align-items-center gap-3">
                <div
                  className={`favorite-button ${favorite ? 'fav-active' : ''}`}
                  onClick={handleFavoriteClick}
                  title={favorite ? t('appItem.favorites.remove') : t('appItem.favorites.add')}
                  style={{ cursor: 'pointer' }}
                >
                  {favorite ? (
                    <StarFill className="text-warning" size={20} />
                  ) : (
                    <Star className="text-muted" size={20} />
                  )}
                </div>
                <div className="app-status">
                  <span className={`status ${app.status.toLowerCase()}`}>{app.status}</span>
                </div>
                {app.appVersion && (
                  <div className="version-badge">
                    <span>{t('appItem.version', { version: app.appVersion })}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="footer-right">
              {app.status === 'Active' ? (
                <a href={`/app/${app.id}`} rel="noopener" className="btn btn-secondary">
                  {t('appItem.launch')} <i className="bi bi-arrow-right ms-2"></i>
                </a>
              ) : (
                <button className="btn btn-primary disabled" title={t('appItem.unavailableButtonTitle')}>
                  {t('appItem.unavailable')} <i className="bi bi-lock ms-2"></i>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export { AppItem };
