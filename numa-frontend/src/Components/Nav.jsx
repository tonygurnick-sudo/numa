import { useNavigate } from 'react-router-dom';
import Logo from '../../public/numa-logo.svg';

import { useAuth } from '../Providers/AuthProvider';
import { useState, useEffect } from 'react';

function useNoChatGroup() {
  const { user } = useAuth();
  const groups = user?.decoded_tokens?.idToken?.['cognito:groups'] || [];
  return Array.isArray(groups) ? groups.includes('no-chat') : false;
}
import { Navbar, Button, Dropdown } from 'react-bootstrap';

const Nav = () => {
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const limitedAccess = useNoChatGroup();

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
            <Dropdown.Item onClick={() => navigate('/dash')}>
              <i className="bi bi-grid-1x2-fill me-2" style={{ color: 'var(--color-icon)' }}></i>
              Dashboard
            </Dropdown.Item>
            <Dropdown.Item onClick={() => navigate('/favourite-apps')}>
              <i className="bi bi-star-fill me-2" style={{ color: 'var(--color-icon)' }}></i>
              Favorites
            </Dropdown.Item>
            {!limitedAccess && (
              <Dropdown.Item onClick={() => navigate('/chat')}>
                <i className="bi bi-chat-dots-fill me-2" style={{ color: 'var(--color-icon)' }}></i>
                Chat
              </Dropdown.Item>
            )}
            <Dropdown.Item onClick={() => navigate('/company-info')}>
              <i className="bi bi-building-fill me-2" style={{ color: 'var(--color-icon)' }}></i>
              Company Info
            </Dropdown.Item>
            <Dropdown.Item onClick={() => navigate('/upload')}>
              <i className="bi bi-cloud-upload-fill me-2" style={{ color: 'var(--color-icon)' }}></i>
              Upload Files
            </Dropdown.Item>
            {!limitedAccess && (
              <Dropdown.Item onClick={() => navigate('/user-management')}>
                <i className="bi bi-people-fill me-2" style={{ color: 'var(--color-icon)' }}></i>
                User Management
              </Dropdown.Item>
            )}
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
          <li>
            <div className="nav-link nav-item" onClick={() => navigate('/dash')} title="Dashboard" role="button">
              <i className="bi bi-grid-1x2-fill icon" style={{ color: 'var(--color-icon)' }}></i>
              <span className="icon-label">Dash</span>
            </div>
          </li>
          <li>
            <div
              className="nav-link nav-item"
              onClick={() => navigate('/favourite-apps')}
              title="Favorite Apps"
              role="button"
            >
              <i className="bi bi-star-fill icon" style={{ color: 'var(--color-icon)' }}></i>
              <span className="icon-label">Favs</span>
            </div>
          </li>
          {!limitedAccess && (
            <li>
              <div className="nav-link nav-item" onClick={() => navigate('/chat')} title="Chat" role="button">
                <i className="bi bi-chat-dots-fill icon" style={{ color: 'var(--color-icon)' }}></i>
                <span className="icon-label">Chat</span>
              </div>
            </li>
          )}
          <li>
            <div
              className="nav-link nav-item"
              onClick={() => navigate('/company-info')}
              title="Company Info"
              role="button"
            >
              <i className="bi bi-building-fill icon" style={{ color: 'var(--color-icon)' }}></i>
              <span className="icon-label">Company</span>
            </div>
          </li>
          <li>
            <div className="nav-link nav-item" onClick={() => navigate('/upload')} title="Upload" role="button">
              <i className="bi bi-cloud-upload-fill icon" style={{ color: 'var(--color-icon)' }}></i>
              <span className="icon-label">Files</span>
            </div>
          </li>
        </ul>

        <footer className="footer">
          {!limitedAccess && (
            <div
              className="nav-link nav-item"
              onClick={() => navigate('/user-management')}
              title="User Management"
              role="button"
            >
              <i className="bi bi-people-fill icon" style={{ color: 'var(--color-icon)' }}></i>
            </div>
          )}
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
