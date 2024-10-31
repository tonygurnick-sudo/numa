import { useNavigate } from 'react-router-dom';
import Logo from '../assets/images/logo-accelerate.svg';
import { useAuth } from '../Providers/AuthProvider';

const Nav = () => {
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();

  const logout = () => {
    authLogout();
    navigate('/login');
    window.location.reload(false);
  };

  return (
    <>
      <nav>
        <a href="/dash" rel="noopener">
          <img src={Logo} className="logo-bk" alt="Arcanum" />
        </a>

        <ul>
          <li>
            <a href="/solutions" id="nav_solutions" rel="noopener"></a>
          </li>
        </ul>
        <footer>
          <a href="/my-account" rel="noopener"></a>
          <button onClick={logout} className="btn-logout">
            Log out
          </button>
          <span className="platform_version">v0.1</span>
        </footer>
      </nav>

      {/* <Intercom /> */}
    </>
  );
};

export { Nav };
