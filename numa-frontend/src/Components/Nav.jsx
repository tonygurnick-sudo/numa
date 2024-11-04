import { useNavigate } from 'react-router-dom';
import Logo from '../assets/images/logo-accelerate.svg';
import { useAuth } from '../Providers/AuthProvider';
import { useState, useEffect } from 'react';
import { Navbar, Button, Dropdown } from 'react-bootstrap';

const hoverStyles = `
  .nav-item:hover {
    transform: scale(1.1);
  }
  .nav-item {
    transition: transform 0.2s ease;
  }
  .dropdown-toggle::after {
    display: none !important;
  }
`;

const styles = {
  nav: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    height: '100vh',
    borderRight: '1px solid #eee',
    width: '60px',
    backgroundColor: '#1a1a1a',
  },
  divider: {
    width: '80%',
    height: '1px',
    backgroundColor: 'white',
    margin: '1rem 0',
    opacity: 1,
  },
  navLinks: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.5rem',
    listStyle: 'none',
    padding: 0,
    margin: '0.5rem 0',
    width: '100%',
  },
  navLink: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.15rem',
    color: 'white',
    cursor: 'pointer',
    width: '100%',
  },
  icon: {
    fontSize: '1.2rem',
  },
  footer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1rem',
    width: '100%',
  },
  version: {
    color: 'white',
    opacity: 0.5,
    fontSize: '0.8rem',
  },
  iconLabel: {
    fontSize: '0.7rem',
    marginTop: '0.15rem',
    color: 'white',
    textAlign: 'center',
  },
};

const styleSheet = document.createElement('style');
styleSheet.innerText = hoverStyles;
document.head.appendChild(styleSheet);

const menuItemStyle = {
  color: 'white',
  display: 'flex',
  alignItems: 'center',
  padding: '0.5rem',
  cursor: 'pointer',
  transition: 'background-color 0.2s ease',
  ':hover': {
    backgroundColor: '#2a2a2a',
  },
};

const Nav = () => {
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
      <nav style={styles.nav}>
        <div
          className="btn-logout"
          onClick={() => navigate('/dash')}
          role="button"
        >
          <img src={Logo} className="logo-bk" alt="Arcanum" />
        </div>
        <div style={styles.divider}></div>

        <ul style={styles.navLinks}>
          <li>
            <div
              style={styles.navLink}
              onClick={() => navigate('/dash')}
              title="Dashboard"
              role="button"
              className="nav-item"
            >
              <i className="bi bi-grid-1x2-fill" style={styles.icon}></i>
              <span style={styles.iconLabel}>Dash</span>
            </div>
          </li>
          <li>
            <div
              style={styles.navLink}
              onClick={() => navigate('/chat')}
              title="Chat"
              role="button"
              className="nav-item"
            >
              <i className="bi bi-chat-dots-fill" style={styles.icon}></i>
              <span style={styles.iconLabel}>Chat</span>
            </div>
          </li>
          <li>
            <div
              style={styles.navLink}
              onClick={() => navigate('/upload')}
              title="Upload"
              role="button"
              className="nav-item"
            >
              <i className="bi bi-cloud-upload-fill" style={styles.icon}></i>
              <span style={styles.iconLabel}>Files</span>
            </div>
          </li>
        </ul>

        <footer style={styles.footer}>
          <div
            style={styles.navLink}
            onClick={() => navigate('/my-account')}
            title="Settings"
            role="button"
            className="nav-item"
          >
            <i className="bi bi-gear-fill" style={styles.icon}></i>
          </div>
          <button className="btn-logout" onClick={logout}>
            Log out
          </button>
          <span style={styles.version}>v0.1</span>
        </footer>
      </nav>
    </>
  );
};

export { Nav };
