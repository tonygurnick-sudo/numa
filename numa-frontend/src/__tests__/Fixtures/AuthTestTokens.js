export const authTestTokens = {
  // Valid token set with future expiration
  valid: {
    tokens: {
      accessToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MTYyMzkwMjJ9.mock-signature`,
      idToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJleHAiOjE2MTYyMzkwMjJ9.mock-signature`,
      refreshToken: 'valid-refresh-token',
    },
    decoded_tokens: {
      accessToken: { exp: Math.floor(Date.now() / 1000) + 3600 }, // 1 hour in future
      idToken: { exp: Math.floor(Date.now() / 1000) + 3600, sub: 'test-user' },
    },
  },

  // Expired token set
  expired: {
    tokens: {
      accessToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MTYyMzkwMjJ9.mock-signature`,
      idToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJleHAiOjE2MTYyMzkwMjJ9.mock-signature`,
      refreshToken: 'valid-refresh-token',
    },
    decoded_tokens: {
      accessToken: { exp: Math.floor(Date.now() / 1000) - 1000 }, // expired
      idToken: { exp: Math.floor(Date.now() / 1000) - 1000, sub: 'test-user' },
    },
  },

  // Mock refresh responses
  refreshResponses: {
    success: {
      AuthenticationResult: {
        AccessToken: 'new-access-token',
        IdToken: 'new-id-token',
        RefreshToken: 'valid-refresh-token',
      },
    },
    failure: null,
  },
};
