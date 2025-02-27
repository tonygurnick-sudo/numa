import { Preloader } from './Preloader';
import { StarFill, Star } from 'react-bootstrap-icons';
import { useFavorites } from '../hooks/useFavorites';

const AppItem = ({ app }) => {
  // Get first 3 tags for display
  const displayTags = app?.tags?.slice(0, 3) || [];

  const { isFavorite, toggleFavorite } = useFavorites();
  const favorite = isFavorite(app.id);

  const handleFavoriteClick = (e) => {
    e.preventDefault(); // Prevent card click from triggering
    toggleFavorite(app.id);
    if (favorite) {
      // navigate('/favourite-apps');
      window.location.reload();
    }
  };

  return (
    <div
      className={`card card-apps w-100 ${app.status !== 'Active' ? 'card-disabled' : ''}`}
      data-testid={`app-card-${app.id}`}
      title={app.status !== 'Active' ? 'This app is unavailable' : ''}
      data-tooltip-delay="500"
    >
      <div className={`card-category ${app?.category?.toLowerCase()}`}>
        {app?.category?.toLowerCase().replace(/\b\w/g, (l) => l.toUpperCase()) || '\u00A0'}
      </div>
      <div className="card-header">
        <div className="header-top">
          <div className="app-name">
            <i className="bi bi-window app-item-icon"></i>
            <a href={`/app/${app.id}`} rel="noopener">
              {app?.appName}
            </a>
          </div>
          <div className="header-right"></div>
        </div>
        <div className="app-tags" style={{ justifyContent: 'left' }}>
          {displayTags.map((tag, index) => (
            <span key={index} className={`tag-pill tag-${['green', 'purple', 'blue'][index % 3]}`}>
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="card-body">
        <hr />
        <div className="app-info">
          <div className="app-description">
            {app.appDescription === 'Loading...' ? (
              <Preloader smallscreen={true} />
            ) : (
              <div className="description-text">{app.appDescription}</div>
            )}
          </div>
        </div>
      </div>
      <div className="card-footer">
        <div className="footer-content">
          <div className="footer-left">
            <div className="d-flex align-items-center gap-4 mb-3"></div>
            <div className="d-flex align-items-center gap-3">
              <div className={`favorite-button ${favorite ? 'fav-active' : ''}`} onClick={handleFavoriteClick}>
                {favorite ? <StarFill className="text-warning" size={24} /> : <Star className="text-muted" size={24} />}
              </div>
              <div className="app-status">
                <span className={`status ${app.status.toLowerCase()}`}>{app.status}</span>
              </div>
              <div className="badge-status">
                <span className="badge rounded-pill">
                  {app.appVersion && <label data-testid="app-version">v{app.appVersion}</label>}
                </span>
              </div>
            </div>
          </div>
          <div className="footer-right">
            {app.status === 'Active' ? (
              <a href={`/app/${app.id}`} rel="noopener">
                <div className="icon-flip-container">
                  <div className="icon-flipper">
                    <div className="front">
                      <i className="bi bi-arrow-right-circle"></i>
                    </div>
                    <div className="back">
                      <i className="bi bi-arrow-right-circle"></i>
                    </div>
                  </div>
                </div>
              </a>
            ) : (
              <div className="icon-flip-container disabled" title="App is unavailable">
                <div className="icon-flipper">
                  <div className="front">
                    <i className="bi bi-arrow-right-circle text-muted"></i>
                  </div>
                  <div className="back">
                    <i className="bi bi-arrow-right-circle text-muted"></i>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export { AppItem };
