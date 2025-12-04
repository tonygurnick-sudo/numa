import { useNavigate } from 'react-router-dom';
import { useAuth } from '../Providers/AuthProvider';
import { useState, useEffect, useCallback } from 'react';
import { Navbar, Button, Dropdown } from 'react-bootstrap';
import { FeatureWrapper } from './RequiredFeaturesWrapper';
import { useBranding } from '../Providers/BrandingContext';
import DefaultLogo from '../../public/numa-logo.svg';
import { useBrandingAsset } from '../hooks/useBrandingAsset';
import { VersionDisplay } from './VersionDisplay';
import { useDrawerBackClose } from '../hooks/useDrawerBackClose';

interface NavProps {
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Nav = ({ isCollapsed = false, onToggleCollapse }: NavProps) => {
  const navigate = useNavigate();
  const { logout: authLogout, user } = useAuth();
  const { branding } = useBranding();
  const rawNavLogo = branding.resolvedAssets?.logoNav || branding.assets?.logoNav || branding.logo || DefaultLogo;
  const navLogo = useBrandingAsset(rawNavLogo, DefaultLogo);
  const navName = branding.name || '';

  // Get user email from decoded token
  const userEmail = user?.decoded_tokens?.idToken?.email || 'user@example.com';
  const userInitial = userEmail?.[0]?.toUpperCase() || 'U';

  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [navItems, setNavItems] = useState([]);
  const isExpanded = !isCollapsed;
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    import('../utils/routeConfig.tsx').then((mod) => {
      if (!isMounted) return;
      const items = mod.ROUTE_CONFIG.filter((r) => r.nav).map((r) => ({
        to: r.path,
        label: r.nav.label,
        icon: r.nav.icon,
        feature: r.requiredFeature,
        footerOnly: r.nav.footerOnly,
      }));
      setNavItems(items);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const MobileNav = () => {
    const [showDropdown, setShowDropdown] = useState(false);
    const toggleDropdown = () => setShowDropdown((prev) => !prev);
    const handleClose = useCallback(() => setShowDropdown(false), []);

    useDrawerBackClose({
      isOpen: showDropdown,
      onClose: handleClose,
      enabled: isMobile,
      stateKey: 'nav-menu',
    });

    return (
      <Navbar className="mobile-nav" expand={false}>
        <div className="d-flex justify-content-between align-items-center w-100">
          <div className="d-flex align-items-center">
            <div
              className="btn-home-logo-mobile btn-home-logo-mobile navbar-brand"
              onClick={() => navigate('/dash')}
              role="button"
            >
              <img
                src={navLogo}
                className="logo-bk"
                alt={navName}
                style={{ maxHeight: 48, maxWidth: '100%', objectFit: 'contain' }}
              />{' '}
              {navName}
            </div>
          </div>
          <Button
            variant="link"
            className="navbar-toggler"
            onClick={toggleDropdown}
            aria-controls="mobile-nav-dropdown"
            aria-expanded={showDropdown}
            style={{ boxShadow: 'none' }}
            data-testid="mobile-menu-button"
          >
            <i className="bi bi-list"></i>
          </Button>
        </div>
        <Dropdown show={showDropdown} className="w-100" id="nav-dropdown">
          <Dropdown.Menu className="w-100 mt-0">
            {navItems.map((item) => (
              <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                <Dropdown.Item onClick={() => navigate(item.to)}>
                  <i className={`${item.icon} me-2`}></i>
                  {item.label}
                </Dropdown.Item>
              </FeatureWrapper>
            ))}
            <Dropdown.Divider />
            <Dropdown.Item onClick={authLogout}>
              <i className="bi bi-box-arrow-right me-2"></i>
              Log out
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </Navbar>
    );
  };

  return isMobile ? (
    <MobileNav />
  ) : (
    <nav className={`nav-component ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div
        className="btn-home-logo"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          navigate('/dash');
        }}
        role="button"
      >
        <img
          src={navLogo}
          className="logo-bk"
          alt={navName}
          style={{ maxHeight: 48, maxWidth: '100%', objectFit: 'contain' }}
        />
        {isExpanded && <span className="logo-text">{navName}</span>}
      </div>

      {/* Toggle collapse button - below logo */}
      {onToggleCollapse && (
        <button
          className="nav-toggle-btn"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <i className={`bi ${isCollapsed ? 'bi-chevron-right' : 'bi-chevron-left'}`}></i>
        </button>
      )}
      <div className="divider"></div>

      <ul className="nav-links">
        {navItems
          .filter((item) => !item.footerOnly)
          .map((item) => (
            <FeatureWrapper key={item.to} requiredFeature={item.feature}>
              <li>
                <div
                  className="nav-link nav-item"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    navigate(item.to);
                  }}
                  title={item.label}
                  role="button"
                >
                  <div className="nav-icon-container">
                    <i className={`${item.icon} icon`}></i>
                  </div>
                  <span className={`nav-label ${isExpanded ? 'expanded' : ''}`}>
                    {isExpanded ? getExpandedLabel(item.label) : ''}
                  </span>
                </div>
              </li>
            </FeatureWrapper>
          ))}
      </ul>

      <footer className="footer">
        <div className="footer-divider"></div>
        <ul className="nav-links">
          {navItems
            .filter((item) => item.footerOnly)
            .map((item) => (
              <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                <li>
                  <div
                    className="nav-link nav-item"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate(item.to);
                    }}
                    title={item.label}
                    role="button"
                  >
                    <div className="nav-icon-container">
                      <i className={`${item.icon} icon`}></i>
                    </div>
                    <span className={`nav-label ${isExpanded ? 'expanded' : ''}`}>
                      {isExpanded ? getExpandedLabel(item.label) : ''}
                    </span>
                  </div>
                </li>
              </FeatureWrapper>
            ))}
          <li>
            <div className="nav-link nav-item" onClick={authLogout} title="Log out" role="button">
              <div className="nav-icon-container">
                <i className="bi bi-box-arrow-right icon"></i>
              </div>
              <span className={`nav-label ${isExpanded ? 'expanded' : ''}`}>{isExpanded ? 'Log out' : ''}</span>
            </div>
          </li>
        </ul>
        <div className="user-profile-divider"></div>
        <div className="user-profile-section">
          <div className="user-avatar">
            <span className="user-initial">{userInitial}</span>
          </div>
          {isExpanded && (
            <div className="user-info">
              <div className="user-email">{userEmail}</div>
            </div>
          )}
        </div>
        <VersionDisplay />
      </footer>
    </nav>
  );
};

// Helper function to get more descriptive labels when sidebar is expanded
function getExpandedLabel(label) {
  switch (label) {
    case 'Files':
      return 'Knowledge Base';
    case 'Knowledge Base':
      return 'Knowledge Base Management';
    case 'Chat':
      return 'Numa Chat';
    case 'Apps':
      return 'Applications';
    case 'Company':
      return 'Company Information';
    default:
      return label;
  }
}

export { Nav };
