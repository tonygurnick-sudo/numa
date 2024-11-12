import { useNavigate } from 'react-router-dom';
import Logo from '../assets/images/logo-accelerate.svg';
import { useAuth } from '../Providers/AuthProvider';
import { useState, useEffect } from 'react';
import { Navbar, Button, Dropdown } from 'react-bootstrap';

const Nav = () => {
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

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
    <Navbar
      fixed="top"
      className="container-fluid"
      style={{
        backgroundColor: '#1a1a1a',
        borderBottom: '1px solid #eee',
        height: '60px',
        display: 'flex',
        alignItems: 'center',
      }}
    >
      <div className="d-flex justify-content-between align-items-center w-100">
        <Navbar.Brand onClick={() => navigate('/dash')} role="button">
          <img
            src={Logo}
            className="logo-bk"
            alt="Arcanum"
            style={{ height: '50px' }}
          />
        </Navbar.Brand>

        <Dropdown align="end" style={{ display: 'flex', alignItems: 'center' }}>
          <Dropdown.Toggle
            variant="link"
            id="nav-dropdown"
            data-testid="mobile-menu-button"
            style={{
              color: 'white',
              border: 'none',
              padding: '8px',
              display: 'flex',
            }}
          >
            <i className="bi bi-list" style={{ fontSize: '1.8rem' }}></i>
          </Dropdown.Toggle>

          <Dropdown.Menu>
            <Dropdown.Item onClick={() => navigate('/dash')}>
              <i
                className="bi bi-grid-1x2-fill me-2"
                style={{ color: '#666' }}
              ></i>
              Dashboard
            </Dropdown.Item>
            <Dropdown.Item onClick={() => navigate('/chat')}>
              <i
                className="bi bi-chat-dots-fill me-2"
                style={{ color: '#666' }}
              ></i>
              Chat
            </Dropdown.Item>
            <Dropdown.Item onClick={() => navigate('/upload')}>
              <i
                className="bi bi-cloud-upload-fill me-2"
                style={{ color: '#666' }}
              ></i>
              Upload Files
            </Dropdown.Item>
            <Dropdown.Item onClick={() => navigate('/my-account')}>
              <i className="bi bi-gear-fill me-2" style={{ color: '#666' }}></i>
              Settings
            </Dropdown.Item>
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
        <div
          className="btn-logout"
          onClick={() => navigate('/dash')}
          role="button"
        >
          <img src={Logo} className="logo-bk" alt="Arcanum" />
        </div>
        <div className="divider"></div>

        <ul className="nav-links">
          <li>
            <div
              className="nav-link nav-item"
              onClick={() => navigate('/dash')}
              title="Dashboard"
              role="button"
            >
              <i className="bi bi-grid-1x2-fill icon"></i>
              <span className="icon-label">Dash</span>
            </div>
          </li>
          <li>
            <div
              className="nav-link nav-item"
              onClick={() => navigate('/chat')}
              title="Chat"
              role="button"
            >
              <i className="bi bi-chat-dots-fill icon"></i>
              <span className="icon-label">Chat</span>
            </div>
          </li>
          <li>
            <div
              className="nav-link nav-item"
              onClick={() => navigate('/upload')}
              title="Upload"
              role="button"
            >
              <i className="bi bi-cloud-upload-fill icon"></i>
              <span className="icon-label">Files</span>
            </div>
          </li>
        </ul>

        <footer className="footer">
          <div
            className="nav-link nav-item"
            onClick={() => navigate('/my-account')}
            title="Settings"
            role="button"
          >
            <i className="bi bi-gear-fill icon"></i>
          </div>
          <button className="btn-logout" onClick={logout}>
            Log out
          </button>
          <span className="version">v0.1</span>
        </footer>
      </nav>
    </>
  );
};

export { Nav };
