import { useNavigate } from 'react-router-dom';
import Logo from '../../public/numa-logo.svg';
import { useAuth } from '../Providers/AuthProvider';
import { useState, useEffect } from 'react';
import { Navbar, Button, Dropdown } from 'react-bootstrap';
import { FeatureWrapper } from './RequiredFeaturesWrapper';

const Nav = () => {
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [navItems, setNavItems] = useState([]);
  const [isExpanded, setIsExpanded] = useState(false);

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
    import('../utils/routeConfig.jsx').then((mod) => {
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
    return () => (isMounted = false);
  }, []);

  const MobileNav = () => {
    const [showDropdown, setShowDropdown] = useState(false);
    const toggleDropdown = () => setShowDropdown(!showDropdown);

    return (
      <Navbar className="mobile-nav" expand={false}>
        <div className="d-flex justify-content-between align-items-center w-100">
          <div className="d-flex align-items-center">
            <div
              className="btn-home-logo-mobile btn-home-logo-mobile navbar-brand"
              onClick={() => navigate('/dash')}
              role="button"
            >
              <img src={Logo} className="logo-bk" alt="Numa" /> Numa
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
          <Dropdown.Menu className="w-100 mt-2">
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
    <nav
      className={`nav-component ${isExpanded ? 'expanded' : ''}`}
      onMouseEnter={() => setIsExpanded(true)}
      onMouseLeave={() => setIsExpanded(false)}
    >
      <div className="btn-home-logo" onClick={() => navigate('/dash')} role="button">
        <img src={Logo} className="logo-bk" alt="Arcanum" />
        {isExpanded && <span className="logo-text">Numa</span>}
      </div>
      <div className="divider"></div>

      <ul className="nav-links">
        {navItems
          .filter((item) => !item.footerOnly)
          .map((item) => (
            <FeatureWrapper key={item.to} requiredFeature={item.feature}>
              <li>
                <div className="nav-link nav-item" onClick={() => navigate(item.to)} title={item.label} role="button">
                  <div className="nav-icon-container">
                    <i className={`${item.icon} icon`} style={{ color: 'var(--color-icon)' }}></i>
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
        <ul className="nav-links">
          {navItems
            .filter((item) => item.footerOnly)
            .map((item) => (
              <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                <li>
                  <div className="nav-link nav-item" onClick={() => navigate(item.to)} title={item.label} role="button">
                    <div className="nav-icon-container">
                      <i className={`${item.icon} icon`} style={{ color: 'var(--color-icon)' }}></i>
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
                <i className="bi bi-box-arrow-right icon" style={{ color: 'var(--color-icon)' }}></i>
              </div>
              <span className={`nav-label ${isExpanded ? 'expanded' : ''}`}>{isExpanded ? 'Log out' : ''}</span>
            </div>
          </li>
        </ul>
        <span className="version">v0.1</span>
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
