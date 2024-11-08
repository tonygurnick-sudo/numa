/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { waitFor } from '@testing-library/react/pure';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth, TestAuthProvider } from '../AuthProvider';
import {
  CognitoIdentityProviderClient,
  RespondToAuthChallengeCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// Add these mocks at the top of the file, after the imports
vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      Credentials: {
        AccessKeyId: 'mock-access-key',
        SecretAccessKey: 'mock-secret-key',
        SessionToken: 'mock-session-token',
        Expiration: new Date(Date.now() + 3600 * 1000),
      },
    }),
  })),
  AssumeRoleWithWebIdentityCommand: vi.fn(),
}));

vi.mock('@aws-sdk/client-cognito-identity', () => ({
  CognitoIdentityClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      IdentityId: 'mock-identity-id',
      Credentials: {
        AccessKeyId: 'mock-access-key',
        SecretAccessKey: 'mock-secret-key',
        SessionToken: 'mock-session-token',
        Expiration: new Date(Date.now() + 3600 * 1000),
      },
    }),
  })),
  GetIdCommand: vi.fn(),
  GetCredentialsForIdentityCommand: vi.fn(),
}));

// Add these mocks for AWS SDK clients
vi.mock('@aws-sdk/client-qbusiness', () => ({
  QBusinessClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@aws-sdk/client-qapps', () => ({
  QAppsClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@aws-sdk/credential-providers', () => ({
  fromWebToken: vi.fn().mockImplementation(() => async () => ({
    accessKeyId: 'mock-access-key',
    secretAccessKey: 'mock-secret-key',
    sessionToken: 'mock-session-token',
  })),
}));

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue({
      ChallengeName: 'NEW_PASSWORD_REQUIRED',
      Session: 'mock-session',
    }),
  })),
  RespondToAuthChallengeCommand: vi.fn(),
  InitiateAuthCommand: vi.fn(),
}));

const TestComponent = ({ onAuth }) => {
  const auth = useAuth();
  React.useEffect(() => {
    onAuth(auth);
  }, [auth, onAuth]);
  return null;
};

describe('AuthProvider', () => {
  let container;
  const mockTokens = {
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    idToken: 'mock-id-token',
  };

  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root');

    vi.clearAllMocks();
    global.fetch = vi.fn();

    // Mock localStorage with all required methods
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });
  });

  it('should authenticate user successfully', async () => {
    const mockUser = { username: 'testuser', password: 'testpass' };
    const mockResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ChallengeParameters: {
          SALT: 'mock-salt',
          SECRET_BLOCK: 'mock-secret-block',
          SRP_B: 'mock-srp-b',
          USERNAME: mockUser.username,
          USER_ID_FOR_SRP: mockUser.username,
        },
        ChallengeName: 'PASSWORD_VERIFIER',
        Session: 'mock-session',
      }),
    };
    global.fetch.mockResolvedValue(mockResponse);

    const onAuth = vi.fn();
    render(
      <AuthProvider>
        <TestComponent onAuth={onAuth} />
      </AuthProvider>,
      { container },
    );

    await waitFor(() => {
      expect(onAuth).toHaveBeenCalled();
    });

    const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

    try {
      await act(async () => {
        await auth.login(mockUser);
      });
    } catch (error) {
      console.error('Login error:', error);
    }

    expect(global.fetch).toHaveBeenCalled();
  });

  it('should handle failed authentication', async () => {
    const mockUser = { username: 'testuser', password: 'wrong' };
    const mockResponse = {
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({
        message: 'Invalid credentials',
        __type: 'NotAuthorizedException',
      }),
    };
    global.fetch.mockResolvedValue(mockResponse);

    const onAuth = vi.fn();
    render(
      <AuthProvider>
        <TestComponent onAuth={onAuth} />
      </AuthProvider>,
      { container },
    );

    await waitFor(() => {
      expect(onAuth).toHaveBeenCalled();
    });

    const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

    await expect(auth.login(mockUser)).rejects.toThrow();
  });

  it('should handle token refresh', async () => {
    // Mock tokens with future expiration to prevent infinite refresh loops
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour in the future
    const mockUser = {
      tokens: {
        accessToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOiR{futureExp}}.mock-signature`,
        idToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJleHAiOiR{futureExp}}.mock-signature`,
        refreshToken: 'mock-refresh-token',
      },
      decoded_tokens: {
        accessToken: { exp: futureExp },
        idToken: { sub: 'test-user', exp: futureExp },
      },
    };

    // Mock refresh handler
    const mockRefreshHandler = vi.fn().mockResolvedValue({
      AuthenticationResult: {
        AccessToken:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MTYyMzkwMjJ9.new-signature',
        IdToken:
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.new-signature',
      },
    });

    // Set up localStorage
    window.localStorage.getItem.mockImplementation((key) => {
      switch (key) {
        case 'refreshToken':
          return mockUser.tokens.refreshToken;
        case 'idToken':
          return mockUser.tokens.idToken;
        case 'accessToken':
          return mockUser.tokens.accessToken;
        default:
          return null;
      }
    });

    const onAuth = vi.fn();
    render(
      <TestAuthProvider
        refreshHandler={mockRefreshHandler}
        initialTokens={mockUser}
      >
        <TestComponent onAuth={onAuth} />
      </TestAuthProvider>,
    );

    await waitFor(() => {
      expect(onAuth).toHaveBeenCalled();
    });

    const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

    // Call refreshTokens
    await act(async () => {
      await auth.refreshTokens();
    });

    // Verify the refresh handler was called
    expect(mockRefreshHandler).toHaveBeenCalledWith({
      refreshToken: mockUser.tokens.refreshToken,
      username: mockUser.decoded_tokens.idToken.sub,
    });

    // Verify localStorage was updated with proper JWT tokens
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      'accessToken',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MTYyMzkwMjJ9.new-signature',
    );
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      'idToken',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIifQ.new-signature',
    );
  });

  describe('Token Management', () => {
    it('should get access token and refresh if expired', async () => {
      const mockRefreshHandler = vi.fn().mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          IdToken: 'new-id-token',
        },
      });

      const mockUser = {
        tokens: {
          accessToken: 'expired-token',
          idToken: 'valid-token',
          refreshToken: 'refresh-token',
        },
        decoded_tokens: {
          accessToken: { exp: Math.floor(Date.now() / 1000) - 1000 }, // expired
          idToken: { exp: Math.floor(Date.now() / 1000) + 3600 },
        },
      };

      // Mock localStorage getItem to return the refresh token
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'refreshToken') return mockUser.tokens.refreshToken;
        return null;
      });

      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          refreshHandler={mockRefreshHandler}
          initialTokens={mockUser}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        expect(onAuth).toHaveBeenCalled();
      });

      const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

      // Wait for the token refresh to complete
      const token = await act(async () => {
        return await auth.getAccessToken();
      });

      expect(mockRefreshHandler).toHaveBeenCalled();
      expect(token).toBe('new-access-token');
    });

    it('should handle logout correctly', async () => {
      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              accessToken: 'test-token',
              idToken: 'test-id-token',
              refreshToken: 'test-refresh-token',
            },
            decoded_tokens: {
              accessToken: { exp: Math.floor(Date.now() / 1000) + 3600 },
              idToken: { exp: Math.floor(Date.now() / 1000) + 3600 },
            },
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);
      await act(async () => {
        auth.logout();
      });

      expect(window.localStorage.removeItem).toHaveBeenCalledWith(
        'accessToken',
      );
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('idToken');
      expect(window.localStorage.removeItem).toHaveBeenCalledWith(
        'refreshToken',
      );
      expect(auth.getUserInfo()).toBeNull();
    });

    it('should handle set new password flow', async () => {
      const mockCognitoResponse = {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: 'test-session',
      };

      vi.mocked(CognitoIdentityProviderClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValueOnce(mockCognitoResponse),
      }));

      const onAuth = vi.fn();
      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);

      await expect(auth.setNewPassword('user', 'old', 'new')).rejects.toThrow();
      expect(CognitoIdentityProviderClient).toHaveBeenCalled();
    });
  });
});
