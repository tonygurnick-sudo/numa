import { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const loadUserFromTokens = () => {
      const accessToken = localStorage.getItem('accessToken');
      const refreshToken = localStorage.getItem('refreshToken');
      if (accessToken && refreshToken) {
        // Here you could add logic to decode the JWT and extract user info
        // For now, we'll just set a simple user object
        setUser({ accessToken, refreshToken });
      }
    };

    loadUserFromTokens();
  }, []);

  const getAccessToken = () => {
    return user ? user.accessToken : null;
  };

  const getRefreshToken = () => {
    return user ? user.refreshToken : null;
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, getAccessToken, getRefreshToken, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
