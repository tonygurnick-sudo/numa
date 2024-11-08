export const mockTokens = {
  // Valid token set
  valid: {
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    idToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    refreshToken: 'valid-refresh-token-123',
  },

  // Different scenarios of decoded tokens
  decoded: {
    // Valid token payload
    valid: {
      sub: 'user123',
      email: 'test@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600, // expires in 1 hour
      permissions: ['read', 'write'],
    },

    // Expired token payload
    expired: {
      sub: 'user123',
      email: 'test@example.com',
      exp: Math.floor(Date.now() / 1000) - 3600, // expired 1 hour ago
      permissions: ['read', 'write'],
    },

    // Token with different permissions
    admin: {
      sub: 'admin123',
      email: 'admin@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
      permissions: ['read', 'write', 'admin'],
    },
  },

  // Error responses
  errors: {
    invalidToken: {
      error: 'Invalid token',
      error_description: 'Token has expired',
    },
    networkError: {
      error: 'Network error',
      error_description: 'Failed to fetch',
    },
  },
};
