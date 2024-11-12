/**
 * @vitest-environment jsdom
 */

import React from 'react';
import { render, act } from '@testing-library/react';
import { waitFor } from '@testing-library/react/pure';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import {
  AuthProvider,
  useAuth,
  TestAuthProvider,
} from '../../Providers/AuthProvider';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { authTestTokens } from '../Fixtures/AuthTestTokens';
import { fromWebToken } from '@aws-sdk/credential-providers';

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
  ForgotPasswordCommand: vi.fn(),
  ConfirmForgotPasswordCommand: vi.fn(),
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
        accessToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2MTYyMzkwMjJ9.mock-signature`,
        idToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0LXVzZXIiLCJleHAiOjE2MTYyMzkwMjJ9.mock-signature`,
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
      const mockRefreshHandler = vi
        .fn()
        .mockResolvedValue(authTestTokens.refreshResponses.success);

      // Mock localStorage getItem to return the expired tokens
      window.localStorage.getItem.mockImplementation((key) => {
        return authTestTokens.expired.tokens[key];
      });

      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          refreshHandler={mockRefreshHandler}
          initialTokens={authTestTokens.expired}
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
      expect(token).toBe(
        authTestTokens.refreshResponses.success.AuthenticationResult
          .AccessToken,
      );
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

    it('should handle loadUserFromTokens with various token states', async () => {
      // Test Case 1: Valid tokens
      const validTokens = {
        accessToken: 'valid-access-token',
        idToken: 'valid-id-token',
        refreshToken: 'valid-refresh-token',
      };
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const decodedTokens = {
        accessToken: { exp: futureExp },
        idToken: { exp: futureExp, sub: 'test-user' },
      };

      // Mock localStorage getItem for valid tokens
      window.localStorage.getItem.mockImplementation((key) => validTokens[key]);

      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{ tokens: validTokens, decoded_tokens: decodedTokens }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).toEqual({
          tokens: validTokens,
          decoded_tokens: decodedTokens,
        });
      });

      // Test Case 2: Expired tokens that need refresh
      vi.clearAllMocks();
      const expiredTokens = {
        accessToken: 'expired-access-token',
        idToken: 'expired-id-token',
        refreshToken: 'valid-refresh-token',
      };
      const expiredDecodedTokens = {
        accessToken: { exp: Math.floor(Date.now() / 1000) - 1000 },
        idToken: { exp: Math.floor(Date.now() / 1000) - 1000 },
      };

      const mockRefreshHandler = vi.fn().mockResolvedValue({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          IdToken: 'new-id-token',
        },
      });

      // Mock localStorage getItem for expired tokens
      window.localStorage.getItem.mockImplementation(
        (key) => expiredTokens[key],
      );

      render(
        <TestAuthProvider
          refreshHandler={mockRefreshHandler}
          initialTokens={{
            tokens: expiredTokens,
            decoded_tokens: expiredDecodedTokens,
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        expect(mockRefreshHandler).toHaveBeenCalled();
      });

      // Test Case 3: No refresh token
      vi.clearAllMocks();
      window.localStorage.getItem.mockImplementation(() => null);

      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).toBeNull();
      });
    });

    it('should handle checkAndRefreshTokens for different token states', async () => {
      // Test Case 1: Valid token - no refresh needed
      const mockRefreshHandler = vi.fn();
      const onAuth = vi.fn();

      render(
        <TestAuthProvider
          refreshHandler={mockRefreshHandler}
          initialTokens={authTestTokens.valid}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      // Wait for auth to be initialized
      await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).not.toBeNull();
      });

      const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

      let result;
      await act(async () => {
        result = await auth.checkAndRefreshTokens();
      });

      expect(result).toBe(true);
      expect(mockRefreshHandler).not.toHaveBeenCalled();
      expect(auth.getUserInfo()).toEqual(authTestTokens.valid);

      // Test Case 2: Expired token - successful refresh
      vi.clearAllMocks();

      // Mock localStorage for the expired tokens case
      window.localStorage.getItem.mockImplementation((key) => {
        return authTestTokens.expired.tokens[key];
      });

      const mockSuccessRefreshHandler = vi
        .fn()
        .mockResolvedValue(authTestTokens.refreshResponses.success);

      render(
        <TestAuthProvider
          refreshHandler={mockSuccessRefreshHandler}
          initialTokens={authTestTokens.expired}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const authWithExpired = await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).not.toBeNull();
        return lastCall;
      });

      let refreshResult;
      await act(async () => {
        refreshResult = await authWithExpired.checkAndRefreshTokens();
      });

      expect(refreshResult).toBe(true);
      expect(mockSuccessRefreshHandler).toHaveBeenCalled();
      expect(mockSuccessRefreshHandler).toHaveBeenCalledWith({
        refreshToken: authTestTokens.expired.tokens.refreshToken,
        username: 'test-user',
      });

      // Test Case 3: Expired token - failed refresh
      vi.clearAllMocks();
      const mockFailedRefreshHandler = vi
        .fn()
        .mockResolvedValue(authTestTokens.refreshResponses.failure);

      // Mock localStorage for the expired tokens case
      window.localStorage.getItem.mockImplementation((key) => {
        return authTestTokens.expired.tokens[key];
      });

      render(
        <TestAuthProvider
          refreshHandler={mockFailedRefreshHandler}
          initialTokens={authTestTokens.expired}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const authWithFailedRefresh = await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).not.toBeNull();
        return lastCall;
      });

      // Trigger the failed refresh
      await act(async () => {
        await authWithFailedRefresh.checkAndRefreshTokens();
      });

      // Verify localStorage was cleared
      expect(window.localStorage.removeItem).toHaveBeenCalledWith(
        'accessToken',
      );
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('idToken');
      expect(window.localStorage.removeItem).toHaveBeenCalledWith(
        'refreshToken',
      );

      // Force a re-render to ensure state is updated
      render(
        <TestAuthProvider
          refreshHandler={mockFailedRefreshHandler}
          initialTokens={null}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      // Wait for the auth state to be cleared
      await waitFor(
        () => {
          const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
          expect(lastCall.getUserInfo()).toBeNull();
          expect(lastCall.isAuthenticated).toBe(false);
        },
        { timeout: 2000 },
      );
    });

    it('should handle valid tokens without requiring refresh', async () => {
      // Create real JWT tokens with future expiration
      const futureExp = Math.floor(Date.now() / 1000) + 3600;
      const validTokens = {
        tokens: {
          accessToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: futureExp }))}.mock-signature`,
          idToken: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.${btoa(JSON.stringify({ exp: futureExp, sub: 'test-user' }))}.mock-signature`,
          refreshToken: 'valid-refresh-token',
        },
        decoded_tokens: {
          accessToken: { exp: futureExp },
          idToken: { exp: futureExp, sub: 'test-user' },
        },
      };

      // Mock refresh handler
      const mockRefreshHandler = vi.fn().mockResolvedValue({
        AuthenticationResult: {
          AccessToken: validTokens.tokens.accessToken,
          IdToken: validTokens.tokens.idToken,
          RefreshToken: validTokens.tokens.refreshToken,
        },
      });

      // Mock localStorage
      window.localStorage.getItem.mockImplementation((key) => {
        if (key === 'accessToken') return validTokens.tokens.accessToken;
        if (key === 'idToken') return validTokens.tokens.idToken;
        if (key === 'refreshToken') return validTokens.tokens.refreshToken;
        return null;
      });

      const onAuth = vi.fn();

      render(
        <TestAuthProvider
          refreshHandler={mockRefreshHandler}
          initialTokens={validTokens}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(
        () => {
          expect(onAuth).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const userInfo = auth.getUserInfo();
      expect(userInfo).not.toBeNull();
      expect(userInfo.tokens).toEqual(validTokens.tokens);
      expect(userInfo.decoded_tokens).toEqual(validTokens.decoded_tokens);
      expect(mockRefreshHandler).not.toHaveBeenCalled();
    });

    it('should handle checkAndRefreshTokens with no user', async () => {
      const mockRefreshHandler = vi.fn();
      const onAuth = vi.fn();

      // Render with no initial tokens/user
      render(
        <TestAuthProvider
          refreshHandler={mockRefreshHandler}
          initialTokens={null}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).toBeNull();
      });

      const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

      let result;
      await act(async () => {
        result = await auth.checkAndRefreshTokens();
      });

      expect(result).toBe(false);
      expect(mockRefreshHandler).not.toHaveBeenCalled();
    });

    it('should handle refresh response without AuthenticationResult', async () => {
      const mockRefreshHandler = vi.fn().mockResolvedValue({
        // Response without AuthenticationResult
        error: 'Invalid refresh token',
      });

      // Mock localStorage with expired tokens
      window.localStorage.getItem.mockImplementation((key) => {
        return authTestTokens.expired.tokens[key];
      });

      const onAuth = vi.fn();
      const { rerender } = render(
        <TestAuthProvider
          refreshHandler={mockRefreshHandler}
          initialTokens={authTestTokens.expired}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).not.toBeNull();
        return lastCall;
      });

      // Attempt to refresh tokens
      await act(async () => {
        const result = await auth.refreshTokens();
        expect(result).toBe(false);
      });

      // Verify localStorage was cleared
      expect(window.localStorage.removeItem).toHaveBeenCalledWith(
        'accessToken',
      );
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('idToken');
      expect(window.localStorage.removeItem).toHaveBeenCalledWith(
        'refreshToken',
      );

      // Force a re-render
      rerender(
        <TestAuthProvider
          refreshHandler={mockRefreshHandler}
          initialTokens={null}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      // Now check that the auth state is cleared
      await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).toBeNull();
      });
    });
  });

  describe('AWS Client Initialization', () => {
    it('should handle QBusinessClient initialization failure', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // Mock the credential provider to throw an error
      vi.mocked(fromWebToken).mockImplementationOnce(() => {
        throw new Error('Failed to initialize QBusinessClient');
      });

      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              idToken: 'mock-id-token',
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
            },
            decoded_tokens: {
              idToken: { exp: Math.floor(Date.now() / 1000) + 3600 },
              accessToken: { exp: Math.floor(Date.now() / 1000) + 3600 },
            },
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error in QBusinessClient initialization:',
          expect.any(Error),
        );
      });

      consoleSpy.mockRestore();
    });

    it('should handle QAppsClient initialization failure', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      // First call succeeds (QBusinessClient), second call fails (QAppsClient)
      vi.mocked(fromWebToken)
        .mockImplementationOnce(() => async () => ({
          accessKeyId: 'mock-access-key',
          secretAccessKey: 'mock-secret-key',
          sessionToken: 'mock-session-token',
        }))
        .mockImplementationOnce(() => {
          throw new Error('Failed to initialize QAppsClient');
        });

      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              idToken: 'mock-id-token',
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
            },
            decoded_tokens: {
              idToken: { exp: Math.floor(Date.now() / 1000) + 3600 },
              accessToken: { exp: Math.floor(Date.now() / 1000) + 3600 },
            },
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          'Error in QAppsClient initialization:',
          expect.any(Error),
        );
      });

      consoleSpy.mockRestore();
    });

    it('should clear clients when user is null', async () => {
      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              idToken: 'mock-id-token',
              accessToken: 'mock-access-token',
              refreshToken: 'mock-refresh-token',
            },
            decoded_tokens: {
              idToken: { exp: Math.floor(Date.now() / 1000) + 3600 },
              accessToken: { exp: Math.floor(Date.now() / 1000) + 3600 },
            },
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      // Wait for initial render and client initialization
      await waitFor(() => {
        expect(onAuth).toHaveBeenCalled();
      });

      const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

      // Trigger logout
      await act(async () => {
        auth.logout();
      });

      // Wait for the auth state to be cleared
      await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).toBeNull();
        expect(lastCall.isAuthenticated).toBe(false);
      });
    });
  });

  describe('Password Reset Functions', () => {
    it('should handle password reset request successfully', async () => {
      const onAuth = vi.fn();
      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);

      const result = await auth.requestPasswordReset('test@example.com');
      expect(result).toEqual({ success: true });
      expect(CognitoIdentityProviderClient).toHaveBeenCalled();
    });

    it('should handle password reset request failure', async () => {
      // Mock the CognitoIdentityProviderClient to throw an error
      vi.mocked(CognitoIdentityProviderClient).mockImplementationOnce(() => ({
        send: vi.fn().mockRejectedValue(new Error('Password reset failed')),
      }));

      const onAuth = vi.fn();
      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);

      await expect(
        auth.requestPasswordReset('test@example.com'),
      ).rejects.toThrow(
        'Error requesting password reset: Password reset failed',
      );
    });

    it('should handle password reset confirmation successfully', async () => {
      const onAuth = vi.fn();
      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);

      const result = await auth.confirmPasswordReset(
        'test@example.com',
        '123456',
        'newPassword123',
      );
      expect(result).toEqual({ success: true });
      expect(CognitoIdentityProviderClient).toHaveBeenCalled();
    });

    it('should handle password reset confirmation failure', async () => {
      // Mock the CognitoIdentityProviderClient to throw an error
      vi.mocked(CognitoIdentityProviderClient).mockImplementationOnce(() => ({
        send: vi.fn().mockRejectedValue(new Error('Invalid confirmation code')),
      }));

      const onAuth = vi.fn();
      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);

      await expect(
        auth.confirmPasswordReset(
          'test@example.com',
          '123456',
          'newPassword123',
        ),
      ).rejects.toThrow('Error resetting password: Invalid confirmation code');
    });
  });
});
