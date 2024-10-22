import { createContext, useState, useContext, useEffect } from 'react';
import { jwtDecode } from 'jwt-decode';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const decodeToken = (token) => {
    try {
      return jwtDecode(token);
    } catch (error) {
      console.error('Error decoding token:', error);
      return null;
    }
  };

  useEffect(() => {
    const loadUserFromTokens = () => {
      const accessToken = localStorage.getItem('accessToken');
      const idToken = localStorage.getItem('idToken');
      const refreshToken = localStorage.getItem('refreshToken');

      if (accessToken && refreshToken && idToken) {
        const decodedAccessToken = decodeToken(accessToken);
        const decodedIdToken = decodeToken(idToken);

        if (decodedAccessToken && decodedIdToken) {
          setUser({
            tokens: {
              accessToken,
              idToken,
              refreshToken,
            },
            decoded_tokens: {
              accessToken: decodedAccessToken,
              idToken: decodedIdToken,
            },
          });
        }
      }
      setLoading(false);
    };

    loadUserFromTokens();
  }, []);

  const getAccessToken = () => {
    return user ? user.tokens.accessToken : null;
  };

  const getRefreshToken = () => {
    return user ? user.tokens.refreshToken : null;
  };

  const getIdToken = () => {
    return user ? user.tokens.idToken : null;
  };

  const getUserInfo = () => {
    if (!user) return null;
    return {
      tokens: user.tokens,
      decoded_tokens: user.decoded_tokens,
    };
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
        getUserInfo,
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
