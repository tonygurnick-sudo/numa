/**
 * @vitest-environment jsdom
 */
import { setupAwsMocks, mockCognitoIdentityProviderClient } from '../Mocks/AwsMock';

import React from 'react';
import { render, act } from '@testing-library/react';
import { waitFor } from '@testing-library/react/pure';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom';
import { AuthProvider, useAuth, TestAuthProvider } from '../../Providers/AuthProvider';
import { authTestTokens } from '../Fixtures/AuthTestTokens';
import { fromWebToken } from '@aws-sdk/credential-providers';

setupAwsMocks();

// Common test tokens
const TEST_TOKENS = {
  expired: {
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2NDA5OTUyMDB9.mock-signature',
    idToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE2NDA5OTUyMDAsInN1YiI6InRlc3QtdXNlciJ9.mock-signature',
    refreshToken: 'mock-refresh-token',
    decoded: {
      accessToken: { exp: 1640995200 },
      idToken: {
        exp: 1640995200,
        sub: 'test-user',
        'cognito:groups': [],
      },
    },
  },
  valid: {
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTl9.new-signature',
    idToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjk5OTk5OTk5OTksInN1YiI6InRlc3QtdXNlciJ9.new-signature',
    refreshToken: 'mock-refresh-token',
    decoded: {
      accessToken: { exp: 9999999999 },
      idToken: {
        exp: 9999999999,
        sub: 'test-user',
        'cognito:groups': [],
      },
    },
  },
};

const TestComponent = ({ onAuth }) => {
  const auth = useAuth();
  React.useEffect(() => {
    onAuth(auth);
  }, [auth, onAuth]);
  return null;
};

describe('AuthProvider', () => {
  let mockSessionStorage = {};
  let mockStorage = {};

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up required session storage values
    mockSessionStorage = {
      ROLE_ARN: 'arn:aws:iam::123456789012:role/test-role',
      USER_POOL_ID: 'us-east-1_testpool',
      API_ENDPOINT: 'https://api.example.com',
      CLIENT_ID: 'test-client-id',
      REGION: 'us-east-1',
      IDENTITY_POOL_ID: 'us-east-1:test-identity-pool',
      GROUPS: JSON.stringify({
        admin: {
          roleArn: 'arn:aws:iam::123456789012:role/test-admin-role',
          features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
        },
        standard: {
          roleArn: 'arn:aws:iam::123456789012:role/test-standard-role',
          features: ['chat', 'useCompanyData'],
        },
      }),
    };

    // Set up sessionStorage mock
    Object.defineProperty(window, 'sessionStorage', {
      value: {
        getItem: vi.fn((key) => mockSessionStorage[key]),
        setItem: vi.fn((key, value) => {
          mockSessionStorage[key] = value;
        }),
        removeItem: vi.fn((key) => {
          delete mockSessionStorage[key];
        }),
        clear: vi.fn(),
      },
      writable: true,
    });

    // Set up localStorage mock
    mockStorage = {};
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn((key) => mockStorage[key]),
        setItem: vi.fn((key, value) => {
          mockStorage[key] = value;
        }),
        removeItem: vi.fn((key) => {
          delete mockStorage[key];
        }),
        clear: vi.fn(),
      },
      writable: true,
    });

    // Set up container
    document.body.innerHTML = '<div id="root"></div>';
  });

  let container;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
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
        await auth.login(mockUser.username, mockUser.password);
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
    // Mock fetch for secret hash
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hash: 'mock-secret-hash' }),
    });

    // Update the existing CognitoIdentityProviderClient mock
    vi.mocked(mockCognitoIdentityProviderClient.CognitoIdentityProviderClient).mockImplementation(() => ({
      send: vi.fn().mockResolvedValue({
        AuthenticationResult: {
          AccessToken: TEST_TOKENS.valid.accessToken,
          IdToken: TEST_TOKENS.valid.idToken,
        },
      }),
    }));

    // Set up localStorage with expired tokens
    window.localStorage.getItem.mockImplementation((key) => {
      switch (key) {
        case 'refreshToken':
          return TEST_TOKENS.expired.refreshToken;
        case 'idToken':
          return TEST_TOKENS.expired.idToken;
        case 'accessToken':
          return TEST_TOKENS.expired.accessToken;
        default:
          return null;
      }
    });

    const onAuth = vi.fn();
    render(
      <TestAuthProvider
        initialTokens={{
          tokens: {
            accessToken: TEST_TOKENS.expired.accessToken,
            idToken: TEST_TOKENS.expired.idToken,
            refreshToken: TEST_TOKENS.expired.refreshToken,
          },
          decoded_tokens: TEST_TOKENS.expired.decoded,
        }}
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

    // Verify the fetch call was made with userSub
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/srp-hasher',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userSub: TEST_TOKENS.expired.decoded.idToken.sub }),
      }),
    );

    // Verify localStorage was updated with proper JWT tokens
    expect(window.localStorage.setItem).toHaveBeenCalledWith('accessToken', TEST_TOKENS.valid.accessToken);
    expect(window.localStorage.setItem).toHaveBeenCalledWith('idToken', TEST_TOKENS.valid.idToken);
  });

  describe('Token Management', () => {
    it('should get access token and refresh if expired', async () => {
      // Mock fetch for secret hash
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hash: 'mock-secret-hash' }),
      });

      // Update the existing CognitoIdentityProviderClient mock
      vi.mocked(mockCognitoIdentityProviderClient.CognitoIdentityProviderClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({
          AuthenticationResult: {
            AccessToken: TEST_TOKENS.valid.accessToken,
            IdToken: TEST_TOKENS.valid.idToken,
          },
        }),
      }));

      // Set up localStorage with expired tokens
      window.localStorage.getItem.mockImplementation((key) => {
        switch (key) {
          case 'refreshToken':
            return TEST_TOKENS.expired.refreshToken;
          case 'idToken':
            return TEST_TOKENS.expired.idToken;
          case 'accessToken':
            return TEST_TOKENS.expired.accessToken;
          default:
            return null;
        }
      });

      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              accessToken: TEST_TOKENS.expired.accessToken,
              idToken: TEST_TOKENS.expired.idToken,
              refreshToken: TEST_TOKENS.expired.refreshToken,
            },
            decoded_tokens: TEST_TOKENS.expired.decoded,
            groups: ['admin'],
            features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        expect(onAuth).toHaveBeenCalled();
      });

      const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

      // Get the access token which should trigger a refresh
      let token;
      await act(async () => {
        token = await auth.getAccessToken();
      });

      // Verify the fetch call was made with userSub
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/srp-hasher',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userSub: TEST_TOKENS.expired.decoded.idToken.sub }),
        }),
      );

      // Verify localStorage was updated with new tokens
      expect(window.localStorage.setItem).toHaveBeenCalledWith('accessToken', TEST_TOKENS.valid.accessToken);
      expect(window.localStorage.setItem).toHaveBeenCalledWith('idToken', TEST_TOKENS.valid.idToken);

      // Verify the returned token is the new valid token
      expect(token).toBe(TEST_TOKENS.valid.accessToken);
    });

    it('should handle logout correctly', async () => {
      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              accessToken: TEST_TOKENS.valid.accessToken,
              idToken: TEST_TOKENS.valid.idToken,
              refreshToken: TEST_TOKENS.valid.refreshToken,
            },
            decoded_tokens: TEST_TOKENS.valid.decoded,
            groups: ['admin'],
            features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);
      await act(async () => {
        auth.logout();
      });

      expect(window.localStorage.removeItem).toHaveBeenCalledWith('accessToken');
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('idToken');
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('refreshToken');
      expect(auth.getUserInfo()).toBeNull();
    });

    it('should handle set new password flow', async () => {
      const mockCognitoResponse = {
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        Session: 'test-session',
      };

      mockCognitoIdentityProviderClient.CognitoIdentityProviderClient.mockImplementationOnce(() => ({
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
      expect(mockCognitoIdentityProviderClient.CognitoIdentityProviderClient).toHaveBeenCalled();
    });

    it('should handle valid tokens', async () => {
      // Set up localStorage with valid tokens
      window.localStorage.getItem.mockImplementation((key) => {
        switch (key) {
          case 'refreshToken':
            return TEST_TOKENS.valid.refreshToken;
          case 'idToken':
            return TEST_TOKENS.valid.idToken;
          case 'accessToken':
            return TEST_TOKENS.valid.accessToken;
          default:
            return null;
        }
      });

      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              accessToken: TEST_TOKENS.valid.accessToken,
              idToken: TEST_TOKENS.valid.idToken,
              refreshToken: TEST_TOKENS.valid.refreshToken,
            },
            decoded_tokens: TEST_TOKENS.valid.decoded,
            groups: ['admin'],
            features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        const lastCall = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];
        expect(lastCall.getUserInfo()).toEqual({
          tokens: {
            accessToken: TEST_TOKENS.valid.accessToken,
            idToken: TEST_TOKENS.valid.idToken,
            refreshToken: TEST_TOKENS.valid.refreshToken,
          },
          decoded_tokens: TEST_TOKENS.valid.decoded,
        });
      });
    });

    it('should handle expired tokens and no refresh token', async () => {
      // Test Case 3: No refresh token
      vi.clearAllMocks();
      window.localStorage.getItem.mockImplementation(() => null);
      const onAuth = vi.fn();

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

    it('should handle valid tokens without requiring refresh', async () => {
      // Mock fetch for secret hash
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hash: 'mock-secret-hash' }),
      });

      // Update the existing CognitoIdentityProviderClient mock
      vi.mocked(mockCognitoIdentityProviderClient.CognitoIdentityProviderClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({
          AuthenticationResult: {
            AccessToken: TEST_TOKENS.valid.accessToken,
            IdToken: TEST_TOKENS.valid.idToken,
          },
        }),
      }));

      // Set up localStorage with valid tokens
      window.localStorage.getItem.mockImplementation((key) => {
        switch (key) {
          case 'refreshToken':
            return TEST_TOKENS.valid.refreshToken;
          case 'idToken':
            return TEST_TOKENS.valid.idToken;
          case 'accessToken':
            return TEST_TOKENS.valid.accessToken;
          default:
            return null;
        }
      });

      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              accessToken: TEST_TOKENS.valid.accessToken,
              idToken: TEST_TOKENS.valid.idToken,
              refreshToken: TEST_TOKENS.valid.refreshToken,
            },
            decoded_tokens: TEST_TOKENS.valid.decoded,
            groups: ['admin'],
            features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        expect(onAuth).toHaveBeenCalled();
      });

      const auth = onAuth.mock.calls[onAuth.mock.calls.length - 1][0];

      // Get user info and verify no refresh was needed
      const userInfo = auth.getUserInfo();
      expect(userInfo).not.toBeNull();
      expect(userInfo.tokens.accessToken).toBe(TEST_TOKENS.valid.accessToken);
      expect(userInfo.tokens.idToken).toBe(TEST_TOKENS.valid.idToken);
      expect(userInfo.tokens.refreshToken).toBe(TEST_TOKENS.valid.refreshToken);

      // Verify the refresh was not called
      expect(global.fetch).not.toHaveBeenCalled();
      expect(mockCognitoIdentityProviderClient.CognitoIdentityProviderClient).not.toHaveBeenCalled();
    });

    it('should handle checkAndRefreshTokens with no user', async () => {
      const mockRefreshHandler = vi.fn();
      const onAuth = vi.fn();

      // Render with no initial tokens/user
      render(
        <TestAuthProvider refreshHandler={mockRefreshHandler} initialTokens={null}>
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
        <TestAuthProvider refreshHandler={mockRefreshHandler} initialTokens={authTestTokens.expired}>
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
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('accessToken');
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('idToken');
      expect(window.localStorage.removeItem).toHaveBeenCalledWith('refreshToken');

      // Force a re-render
      rerender(
        <TestAuthProvider refreshHandler={mockRefreshHandler} initialTokens={null}>
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
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Set up localStorage with valid tokens to avoid refresh
      window.localStorage.getItem.mockImplementation((key) => {
        switch (key) {
          case 'refreshToken':
            return TEST_TOKENS.valid.refreshToken;
          case 'idToken':
            return TEST_TOKENS.valid.idToken;
          case 'accessToken':
            return TEST_TOKENS.valid.accessToken;
          default:
            return null;
        }
      });

      // Mock the credential provider to throw an error
      vi.mocked(fromWebToken).mockImplementationOnce(() => {
        throw new Error('Failed to initialize QBusinessClient');
      });

      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              idToken: TEST_TOKENS.valid.idToken,
              accessToken: TEST_TOKENS.valid.accessToken,
              refreshToken: TEST_TOKENS.valid.refreshToken,
            },
            decoded_tokens: TEST_TOKENS.valid.decoded,
            groups: ['admin'],
            features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Error in QBusinessClient initialization:', expect.any(Error));
      });

      consoleSpy.mockRestore();
    });

    it('should handle QAppsClient initialization failure', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Set up localStorage with valid tokens to avoid refresh
      window.localStorage.getItem.mockImplementation((key) => {
        switch (key) {
          case 'refreshToken':
            return TEST_TOKENS.valid.refreshToken;
          case 'idToken':
            return TEST_TOKENS.valid.idToken;
          case 'accessToken':
            return TEST_TOKENS.valid.accessToken;
          default:
            return null;
        }
      });

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
              idToken: TEST_TOKENS.valid.idToken,
              accessToken: TEST_TOKENS.valid.accessToken,
              refreshToken: TEST_TOKENS.valid.refreshToken,
            },
            decoded_tokens: TEST_TOKENS.valid.decoded,
            groups: ['admin'],
            features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
          }}
        >
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Error in QAppsClient initialization:', expect.any(Error));
      });

      consoleSpy.mockRestore();
    });

    it('should clear clients when user is null', async () => {
      const onAuth = vi.fn();
      render(
        <TestAuthProvider
          initialTokens={{
            tokens: {
              idToken: TEST_TOKENS.valid.idToken,
              accessToken: TEST_TOKENS.valid.accessToken,
              refreshToken: TEST_TOKENS.valid.refreshToken,
            },
            decoded_tokens: TEST_TOKENS.valid.decoded,
            groups: ['admin'],
            features: ['chat', 'useCompanyData', 'addToCompanyData', 'deleteFromCompanyData', 'manageUsers'],
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
    beforeEach(() => {
      // Mock fetch for secret hash
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ hash: 'mock-secret-hash' }),
      });
    });

    it('should handle password reset request successfully', async () => {
      // Mock Cognito response for ForgotPassword
      vi.mocked(mockCognitoIdentityProviderClient.CognitoIdentityProviderClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({
          // Empty successful response
        }),
      }));

      const onAuth = vi.fn();
      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);

      // Verify secret hash is fetched first
      const result = await auth.requestPasswordReset('test@example.com');

      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/srp-hasher',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' }),
        }),
      );

      expect(result).toEqual({ success: true });
    });

    it('should handle password reset request failure', async () => {
      // Mock Cognito error response
      vi.mocked(mockCognitoIdentityProviderClient.CognitoIdentityProviderClient).mockImplementation(() => ({
        send: vi.fn().mockRejectedValue(new Error('Password reset failed')),
      }));

      const onAuth = vi.fn();
      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);

      await expect(auth.requestPasswordReset('test@example.com')).rejects.toThrow(
        'Error requesting password reset: Password reset failed',
      );
    });

    it('should handle password reset confirmation successfully', async () => {
      // Mock Cognito response for ConfirmForgotPassword
      vi.mocked(mockCognitoIdentityProviderClient.CognitoIdentityProviderClient).mockImplementation(() => ({
        send: vi.fn().mockResolvedValue({
          // Empty successful response
        }),
      }));

      const onAuth = vi.fn();
      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);

      const result = await auth.confirmPasswordReset('test@example.com', '123456', 'newPassword123');

      // Verify secret hash is fetched
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.example.com/srp-hasher',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@example.com' }),
        }),
      );

      expect(result).toEqual({ success: true });
    });

    it('should handle password reset confirmation failure', async () => {
      // Mock Cognito error response
      vi.mocked(mockCognitoIdentityProviderClient.CognitoIdentityProviderClient).mockImplementation(() => ({
        send: vi.fn().mockRejectedValue(new Error('Invalid confirmation code')),
      }));

      const onAuth = vi.fn();
      render(
        <TestAuthProvider>
          <TestComponent onAuth={onAuth} />
        </TestAuthProvider>,
      );

      const auth = await waitFor(() => onAuth.mock.calls[0][0]);

      await expect(auth.confirmPasswordReset('test@example.com', '123456', 'newPassword123')).rejects.toThrow(
        'Error resetting password: Invalid confirmation code',
      );
    });
  });

  it('should convert email to lowercase during login', async () => {
    const mockUser = { username: 'TestUser@Example.com', password: 'testpass' };
    const mockResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ChallengeParameters: {
          SALT: 'mock-salt',
          SECRET_BLOCK: 'mock-secret-block',
          SRP_B: 'mock-srp-b',
          USERNAME: mockUser.username.toLowerCase(),
          USER_ID_FOR_SRP: mockUser.username.toLowerCase(),
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
        await auth.login(mockUser.username, mockUser.password);
      });
    } catch (error) {
      console.error('Login error:', error);
    }

    // Verify that the username was converted to lowercase in the API call
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/srp-hasher'),
      expect.objectContaining({
        body: JSON.stringify({ email: mockUser.username.toLowerCase() }),
      }),
    );
  });

  it('should convert email to lowercase during password reset request', async () => {
    const mockEmail = 'TestUser@Example.com';
    const mockResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ hash: 'mock-hash' }),
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
        await auth.requestPasswordReset(mockEmail);
      });
    } catch (error) {
      console.error('Password reset error:', error);
    }

    // Verify that the email was converted to lowercase in the API call
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/srp-hasher'),
      expect.objectContaining({
        body: JSON.stringify({ email: mockEmail.toLowerCase() }),
      }),
    );
  });

  it('should convert email to lowercase during set new password', async () => {
    const mockUser = { username: 'TestUser@Example.com', oldPassword: 'oldpass', newPassword: 'newpass' };
    const mockResponse = {
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ChallengeParameters: {
          SALT: 'mock-salt',
          SECRET_BLOCK: 'mock-secret-block',
          SRP_B: 'mock-srp-b',
          USERNAME: mockUser.username.toLowerCase(),
          USER_ID_FOR_SRP: mockUser.username.toLowerCase(),
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
        await auth.setNewPassword(mockUser.username, mockUser.oldPassword, mockUser.newPassword);
      });
    } catch (error) {
      console.error('Set new password error:', error);
    }

    // Verify that the username was converted to lowercase in the API call
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/srp-hasher'),
      expect.objectContaining({
        body: JSON.stringify({ email: mockUser.username.toLowerCase() }),
      }),
    );
  });
});
