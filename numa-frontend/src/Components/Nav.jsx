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

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);

    return () => window.removeEventListener('resize', handleResize);
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

  const logout = () => {
    authLogout();
    navigate('/login');
    window.location.reload(false);
  };

  const MobileNav = () => (
    <Navbar fixed="top" className="container-fluid mobile-nav">
      <div className="d-flex justify-content-between align-items-center w-100">
        <Navbar.Brand onClick={() => navigate('/dash')} role="button" className="btn-home-logo-mobile">
          <img src={Logo} alt="Arcanum" /> &nbsp;Numa
        </Navbar.Brand>

        <Dropdown align="end" style={{ display: 'flex', alignItems: 'center' }}>
          <Dropdown.Toggle variant="link" id="nav-dropdown" data-testid="mobile-menu-button">
            <i className="bi bi-list" style={{ fontSize: '1.8rem' }}></i>
          </Dropdown.Toggle>

          <Dropdown.Menu>
            {navItems.map((item) => (
              <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                <Dropdown.Item onClick={() => navigate(item.to)}>
                  <i className={`${item.icon} me-2`} style={{ color: 'var(--color-icon)' }}></i>
                  {item.label}
                </Dropdown.Item>
              </FeatureWrapper>
            ))}
            <Dropdown.Divider />
            <div className="px-2">
              <Button onClick={logout} className="w-100">
                Log out
              </Button>
            </div>
          </Dropdown.Menu>
        </Dropdown>
      </div>
    </Navbar>
  );

  return isMobile ? (
    <MobileNav />
  ) : (
    <>
      <nav className="nav-component">
        <div className="btn-home-logo" onClick={() => navigate('/dash')} role="button">
          <img src={Logo} className="logo-bk" alt="Arcanum" />
        </div>
        <div className="divider"></div>

        <ul className="nav-links">
          {navItems
            .filter((item) => !item.footerOnly)
            .map((item) => (
              <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                <li>
                  <div className="nav-link nav-item" onClick={() => navigate(item.to)} title={item.label} role="button">
                    <i className={`${item.icon} icon`} style={{ color: 'var(--color-icon)' }}></i>
                    <span className="icon-label">{item.label}</span>
                  </div>
                </li>
              </FeatureWrapper>
            ))}
        </ul>

        <footer className="footer">
          {navItems
            .filter((item) => item.footerOnly)
            .map((item) => (
              <FeatureWrapper key={item.to} requiredFeature={item.feature}>
                <div className="nav-link nav-item" onClick={() => navigate(item.to)} title={item.label} role="button">
                  <i className={`${item.icon} icon`} style={{ color: 'var(--color-icon)' }}></i>
                </div>
              </FeatureWrapper>
            ))}
          <button onClick={logout} className="btn-logout" title="Logout">
            <div className="icon-with-text">
              <i className="bi bi-box-arrow-right"></i>
              <span>Log out</span>
            </div>
          </button>
          <span className="version">v0.1</span>
        </footer>
      </nav>
    </>
  );
};

export { Nav };
