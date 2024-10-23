export const isAuthenticated = () => {
    const token = localStorage.getItem('accessToken');
    return !!token; // Returns true if token exists, false otherwise
  };

  // Function to check if the token has expired
export const isTokenExpired = () => {
    const expirationTime = localStorage.getItem('tokenExpiration');
    const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds

    return expirationTime && currentTime >= expirationTime;
  };

// Function to save tokens to localStorage
export const saveTokens = (tokens) => {
    const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
    const expirationTime = currentTime + tokens.ExpiresIn; // Token expiration time

    localStorage.setItem('accessToken', tokens.AccessToken);
    localStorage.setItem('refreshToken', tokens.RefreshToken);
    localStorage.setItem('tokenExpiration', expirationTime); // Store expiration time
  };

// Function to refresh tokens (you can integrate this if needed in the future)
// export const refreshTokens = async (client, clientId) => {
//     const refreshToken = localStorage.getItem('refreshToken');

//     if (!refreshToken) {
//       return false; // No refresh token, so user has to log in again
//     }

//     const command = new InitiateAuthCommand({
//       AuthFlow: 'REFRESH_TOKEN_AUTH',
//       AuthParameters: {
//         REFRESH_TOKEN: refreshToken,
//       },
//       ClientId: clientId,
//     });

//     try {
//       const response = await client.send(command);
//       const tokens = response.AuthenticationResult;

//       saveTokens(tokens); // Reuse the saveTokens function
//       return true; // Refresh successful
//     } catch (error) {
//       console.error('Error refreshing tokens:', error);
//       return false;
//     }
//   };
