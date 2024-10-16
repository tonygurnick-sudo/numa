import { createContext, useState, useContext, useEffect } from 'react';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadUserFromTokens = () => {
      const accessToken = localStorage.getItem('accessToken');
      const idToken = localStorage.getItem('idToken');
      const refreshToken = localStorage.getItem('refreshToken');
      if (accessToken && refreshToken && idToken) {
        // Here you could add logic to decode the JWT and extract user info
        // For now, we'll just set a simple user object
        setUser({ accessToken, refreshToken, idToken });
      }
      setLoading(false);
    };

    loadUserFromTokens();
  }, []);

  const getAccessToken = () => {
    return user ? user.accessToken : null;
  };

  const getRefreshToken = () => {
    return user ? user.refreshToken : null;
  };

  const getIdToken = () => {
    return user ? user.idToken : null;
  };

  const logout = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('idToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        getAccessToken,
        getRefreshToken,
        getIdToken,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
