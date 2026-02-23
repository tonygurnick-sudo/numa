import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  GetUserCommand,
  GlobalSignOutCommand,
  RespondToAuthChallengeCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  SetUserMFAPreferenceCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider'
import { getConfigValue } from './configService'

export interface User {
  username: string
  email: string
  groups: string[]
  attributes: Record<string, string>
}

export interface AuthSession {
  accessToken: string
  idToken: string
  refreshToken: string
  expiresAt: number
  user: User
}

export interface PasswordChangeRequired {
  requiresPasswordChange: true
  session: string
  username: string
}

export interface MfaSetupRequired {
  requiresMfaSetup: true
  session: string
  username: string
  secretCode: string
  otpauthUrl: string
}

export interface MfaCodeRequired {
  requiresMfaCode: true
  session: string
  username: string
}

class AuthService {
  private client: CognitoIdentityProviderClient
  private userPoolId: string
  private clientId: string
  private session: AuthSession | null = null
  private refreshInFlight: Promise<AuthSession | null> | null = null

  constructor() {
    // Initialize with config values - will be set when config is loaded
    this.userPoolId = ''
    this.clientId = ''
    this.client = new CognitoIdentityProviderClient({
      region: 'us-east-1', // Will be updated when config loads
    })

    // Try to restore session from localStorage
    this.restoreSession()
  }

  private updateConfig(): boolean {
    const region = getConfigValue('AWS_REGION');
    const userPoolId = getConfigValue('USER_POOL_ID');
    const clientId = getConfigValue('USER_POOL_CLIENT_ID');

    if (!region || !userPoolId || !clientId) {
      return false;
    }

    // Update client if region changed
    const currentRegion = this.client.config.region;
    if (currentRegion !== region) {
      this.client = new CognitoIdentityProviderClient({ region });
    }

    this.userPoolId = userPoolId;
    this.clientId = clientId;
    return true;
  }

  private isExpiringSoon(minValidityMs: number): boolean {
    if (!this.session) return true
    return Date.now() >= (this.session.expiresAt - Math.max(minValidityMs, 0))
  }

  private decodeJwt(token: string): Record<string, unknown> | null {
    try {
      const payload = token.split('.')[1]
      if (!payload) return null
      const decoded = atob(payload)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }

  private async buildMfaSetupRequired(session: string, username: string): Promise<MfaSetupRequired> {
    const assoc = await this.client.send(new AssociateSoftwareTokenCommand({
      Session: session,
    }))

    const secret = assoc.SecretCode
    if (!secret) {
      throw new Error('Failed to initiate MFA setup')
    }

    const nextSession = assoc.Session || session
    const issuer = 'Arcanum Customer Success Portal'
    const label = encodeURIComponent(`${issuer}:${username}`)
    const otpauthUrl = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`

    return {
      requiresMfaSetup: true,
      session: nextSession,
      username,
      secretCode: secret,
      otpauthUrl,
    }
  }

  async signIn(email: string, password: string): Promise<AuthSession | PasswordChangeRequired | MfaSetupRequired | MfaCodeRequired> {
    // Ensure config is loaded
    if (!this.updateConfig()) {
      throw new Error('Configuration not loaded. Please refresh the page.');
    }

    try {
      const command = new InitiateAuthCommand({
        AuthFlow: 'USER_PASSWORD_AUTH',
        ClientId: this.clientId,
        AuthParameters: {
          USERNAME: email,
          PASSWORD: password,
        },
      })

      const response = await this.client.send(command)

      // Check if we need to handle password change challenge
      if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
        return {
          requiresPasswordChange: true,
          session: response.Session!,
          username: email,
        }
      }

      // MFA setup required (no device enrolled yet)
      if (response.ChallengeName === 'MFA_SETUP') {
        return await this.buildMfaSetupRequired(response.Session!, email)
      }

      // MFA required (user already enrolled)
      if (response.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
        return {
          requiresMfaCode: true,
          session: response.Session!,
          username: email,
        }
      }

      if (!response.AuthenticationResult) {
        throw new Error('Authentication failed')
      }

      const { AccessToken, IdToken, RefreshToken, ExpiresIn } = response.AuthenticationResult

      if (!AccessToken || !IdToken || !RefreshToken) {
        throw new Error('Incomplete authentication response')
      }

      const userInfo = await this.getUserInfo(AccessToken)

      const session: AuthSession = {
        accessToken: AccessToken,
        idToken: IdToken,
        refreshToken: RefreshToken,
        expiresAt: Date.now() + (ExpiresIn! * 1000),
        user: userInfo,
      }

      this.session = session
      this.storeSession(session)

      return session
    } catch (error) {
      console.error('Sign in error:', error)
      throw new Error('Invalid email or password')
    }
  }

  async completeMfaSetupAndSignIn(username: string, session: string, code: string): Promise<AuthSession> {
    // Ensure config is loaded
    if (!this.updateConfig()) {
      throw new Error('Configuration not loaded. Please refresh the page.');
    }

    try {
      // Verify the software token code
      const verify = await this.client.send(new VerifySoftwareTokenCommand({
        Session: session,
        UserCode: code,
        FriendlyDeviceName: 'Arcanum CSP',
      }))

      if (verify.Status !== 'SUCCESS') {
        throw new Error('Invalid verification code')
      }

      const nextSession = verify.Session || session

      // Complete the MFA setup challenge, choosing software token as the factor
      const finalize = await this.client.send(new RespondToAuthChallengeCommand({
        ChallengeName: 'MFA_SETUP',
        ClientId: this.clientId,
        Session: nextSession,
        ChallengeResponses: {
          USERNAME: username,
          ANSWER: 'SOFTWARE_TOKEN_MFA',
        },
      }))

      if (!finalize.AuthenticationResult) {
        throw new Error('MFA setup completion failed')
      }

      const { AccessToken, IdToken, RefreshToken, ExpiresIn } = finalize.AuthenticationResult
      if (!AccessToken || !IdToken || !RefreshToken) {
        throw new Error('Incomplete authentication response after MFA setup')
      }

      try {
        await this.client.send(new SetUserMFAPreferenceCommand({
          AccessToken,
          SoftwareTokenMfaSettings: {
            Enabled: true,
            PreferredMfa: true,
          },
        }))
      } catch (setMfaError) {
        console.warn('Failed to set software token MFA preference:', setMfaError)
      }

      const userInfo = await this.getUserInfo(AccessToken)
      const authSession: AuthSession = {
        accessToken: AccessToken,
        idToken: IdToken,
        refreshToken: RefreshToken,
        expiresAt: Date.now() + (ExpiresIn! * 1000),
        user: userInfo,
      }
      this.session = authSession
      this.storeSession(authSession)
      return authSession
    } catch (error) {
      console.error('MFA setup error:', error)
      throw (error instanceof Error ? error : new Error('Failed to complete MFA setup'))
    }
  }

  async respondToMfaCodeAndSignIn(username: string, session: string, code: string): Promise<AuthSession> {
    // Ensure config is loaded
    if (!this.updateConfig()) {
      throw new Error('Configuration not loaded. Please refresh the page.');
    }
    try {
      const challenge = await this.client.send(new RespondToAuthChallengeCommand({
        ChallengeName: 'SOFTWARE_TOKEN_MFA',
        ClientId: this.clientId,
        Session: session,
        ChallengeResponses: {
          USERNAME: username,
          SOFTWARE_TOKEN_MFA_CODE: code,
        },
      }))

      if (!challenge.AuthenticationResult) {
        throw new Error('Invalid MFA code')
      }

      const { AccessToken, IdToken, RefreshToken, ExpiresIn } = challenge.AuthenticationResult
      if (!AccessToken || !IdToken || !RefreshToken) {
        throw new Error('Incomplete authentication response after MFA')
      }

      const userInfo = await this.getUserInfo(AccessToken)
      const authSession: AuthSession = {
        accessToken: AccessToken,
        idToken: IdToken,
        refreshToken: RefreshToken,
        expiresAt: Date.now() + (ExpiresIn! * 1000),
        user: userInfo,
      }
      this.session = authSession
      this.storeSession(authSession)
      return authSession
    } catch (error) {
      console.error('MFA code error:', error)
      throw (error instanceof Error ? error : new Error('Failed to verify MFA code'))
    }
  }

  async completePasswordChange(
    session: string,
    username: string,
    newPassword: string,
    fullName: string,
  ): Promise<AuthSession | MfaSetupRequired | MfaCodeRequired> {
    // Ensure config is loaded
    if (!this.updateConfig()) {
      throw new Error('Configuration not loaded. Please refresh the page.');
    }

    try {
      const command = new RespondToAuthChallengeCommand({
        ChallengeName: 'NEW_PASSWORD_REQUIRED',
        ClientId: this.clientId,
        Session: session,
        ChallengeResponses: {
          USERNAME: username,
          NEW_PASSWORD: newPassword,
          'userAttributes.name': fullName, // Provide the required name attribute
        },
      })

      const response = await this.client.send(command)

      if (response.ChallengeName === 'MFA_SETUP') {
        return await this.buildMfaSetupRequired(response.Session!, username)
      }

      if (response.ChallengeName === 'SOFTWARE_TOKEN_MFA') {
        return {
          requiresMfaCode: true,
          session: response.Session!,
          username,
        }
      }

      if (!response.AuthenticationResult) {
        throw new Error('Password change failed')
      }

      const { AccessToken, IdToken, RefreshToken, ExpiresIn } = response.AuthenticationResult

      if (!AccessToken || !IdToken || !RefreshToken) {
        throw new Error('Incomplete authentication response after password change')
      }

      // Get user information
      const userInfo = await this.getUserInfo(AccessToken)

      const authSession: AuthSession = {
        accessToken: AccessToken,
        idToken: IdToken,
        refreshToken: RefreshToken,
        expiresAt: Date.now() + (ExpiresIn! * 1000),
        user: userInfo,
      }

      this.session = authSession
      this.storeSession(authSession)

      return authSession
    } catch (error) {
      console.error('Password change error:', error)
      throw new Error('Failed to change password. Please try again.')
    }
  }

  async signOut(): Promise<void> {
    if (!this.session) return

    try {
      const command = new GlobalSignOutCommand({
        AccessToken: this.session.accessToken,
      })

      await this.client.send(command)
    } catch (error) {
      console.error('Sign out error:', error)
    } finally {
      this.session = null
      this.clearStoredSession()
    }
  }

  getCurrentSession(): AuthSession | null {
    if (!this.session) return null

    // Check if session is expired
    if (Date.now() >= this.session.expiresAt) {
      this.session = null
      this.clearStoredSession()
      return null
    }

    return this.session
  }

  isAuthenticated(): boolean {
    return this.getCurrentSession() !== null
  }

  getCurrentUser(): User | null {
    const session = this.getCurrentSession()
    return session?.user || null
  }

  hasRole(role: string): boolean {
    const user = this.getCurrentUser()
    return user?.groups.includes(role) || false
  }

  private async getUserInfo(accessToken: string): Promise<User> {
    const command = new GetUserCommand({
      AccessToken: accessToken,
    })

    const response = await this.client.send(command)

    const attributes: Record<string, string> = {}
    response.UserAttributes?.forEach(attr => {
      if (attr.Name && attr.Value) {
        attributes[attr.Name] = attr.Value
      }
    })

    // Prefer groups from ID token if available, fall back to access token groups
    const idGroups = this.session ? this.extractGroupsFromIdToken(this.session.idToken) : []
    const groups = idGroups.length > 0 ? idGroups : this.extractGroupsFromAccessToken(accessToken)

    return {
      username: response.Username || 'unknown',
      email: attributes['email'] || 'unknown@example.com',
      groups,
      attributes,
    }
  }

  private extractGroupsFromAccessToken(accessToken: string): string[] {
    try {
      const payload = this.decodeJwt(accessToken)
      return (payload && (payload['cognito:groups'] as string[])) || []
    } catch (error) {
      console.error('Error parsing access token:', error)
      return []
    }
  }

  private extractGroupsFromIdToken(idToken: string): string[] {
    try {
      const payload = this.decodeJwt(idToken)
      if (!payload) return []
      // Prefer principal tags if present (alignment with numa-frontend), else fall back to cognito:groups
      const awsTags = (payload['https://aws.amazon.com/tags'] as Record<string, unknown>) || null
      const principalGroups = awsTags?.principal_tags?.Groups
      if (Array.isArray(principalGroups) && principalGroups.length > 0) return principalGroups
      return (payload['cognito:groups'] as string[]) || []
    } catch (error) {
      console.error('Error parsing id token:', error)
      return []
    }
  }

  private storeSession(session: AuthSession): void {
    try {
      localStorage.setItem('auth_session', JSON.stringify(session))
    } catch (error) {
      console.error('Error storing session:', error)
    }
  }

  private restoreSession(): void {
    try {
      const stored = localStorage.getItem('auth_session')
      if (stored) {
        const session = JSON.parse(stored) as AuthSession

        // Check if still valid
        if (Date.now() < session.expiresAt) {
          this.session = session
        } else {
          this.clearStoredSession()
        }
      }
    } catch (error) {
      console.error('Error restoring session:', error)
      this.clearStoredSession()
    }
  }

  private clearStoredSession(): void {
    try {
      localStorage.removeItem('auth_session')
    } catch (error) {
      console.error('Error clearing stored session:', error)
    }
  }

  private isTransientError(error: unknown): boolean {
    if (!navigator.onLine) return true
    const message = error instanceof Error ? error.message : String(error)
    const name = error instanceof Error ? error.name : ''
    const transientPatterns = [
      'fetch failed', 'network', 'dns', 'timeout', 'aborted',
      'econnrefused', 'econnreset', 'enotfound', 'load failed',
      'configuration not loaded',
    ]
    const lower = `${name} ${message}`.toLowerCase()
    return transientPatterns.some(p => lower.includes(p))
  }

  private isPermanentAuthError(error: unknown): boolean {
    const name = error instanceof Error ? error.name : ''
    const message = error instanceof Error ? error.message : String(error)
    const lower = `${name} ${message}`.toLowerCase()
    return lower.includes('notauthorizedexception') ||
      lower.includes('usernotfoundexception') ||
      lower.includes('invalid refresh token') ||
      lower.includes('refresh token has been revoked')
  }

  private waitForOnline(timeoutMs = 10000): Promise<boolean> {
    if (navigator.onLine) return Promise.resolve(true)
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        window.removeEventListener('online', handler)
        resolve(navigator.onLine)
      }, timeoutMs)
      const handler = () => {
        clearTimeout(timer)
        window.removeEventListener('online', handler)
        resolve(true)
      }
      window.addEventListener('online', handler)
    })
  }

  async refreshTokens(): Promise<AuthSession | null> {
    if (!this.session) return null
    if (!this.updateConfig()) {
      throw new Error('Configuration not loaded. Please refresh the page.')
    }

    // Reuse in-flight refresh to avoid concurrent refreshes
    if (this.refreshInFlight) {
      return this.refreshInFlight
    }

    const MAX_RETRIES = 3
    const doRefresh = async (): Promise<AuthSession | null> => {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          // Wait for network if offline
          if (!navigator.onLine) {
            const online = await this.waitForOnline()
            if (!online) {
              console.warn('[auth] Still offline after waiting, skipping refresh')
              return this.session
            }
          }

          const command = new InitiateAuthCommand({
            AuthFlow: 'REFRESH_TOKEN_AUTH',
            ClientId: this.clientId,
            AuthParameters: {
              REFRESH_TOKEN: this.session!.refreshToken,
            },
          })

          const response = await this.client.send(command)

          if (!response.AuthenticationResult) {
            throw new Error('Token refresh failed')
          }

          const { AccessToken, IdToken, ExpiresIn } = response.AuthenticationResult
          if (!AccessToken || !IdToken) {
            throw new Error('Incomplete refresh response')
          }

          const userInfo = await this.getUserInfo(AccessToken)

          const updated: AuthSession = {
            accessToken: AccessToken,
            idToken: IdToken,
            refreshToken: this.session!.refreshToken,
            expiresAt: Date.now() + (ExpiresIn! * 1000),
            user: userInfo,
          }

          this.session = updated
          this.storeSession(updated)
          return updated
        } catch (error) {
          // Permanent auth errors — stop retrying and clear session
          if (this.isPermanentAuthError(error)) {
            console.error('[auth] Permanent auth error, clearing session:', error)
            this.session = null
            this.clearStoredSession()
            return null
          }

          // Transient errors — retry with backoff
          if (this.isTransientError(error) && attempt < MAX_RETRIES - 1) {
            const delay = Math.pow(2, attempt) * 1000 // 1s, 2s, 4s
            console.warn(`[auth] Transient refresh error (attempt ${attempt + 1}/${MAX_RETRIES}), retrying in ${delay}ms:`, error)
            await new Promise(r => setTimeout(r, delay))
            continue
          }

          // Final attempt failed or unknown error
          console.error(`[auth] Refresh failed after ${attempt + 1} attempt(s):`, error)
          // Don't clear session for transient errors — keep the existing session
          // so the user stays logged in and we can retry on the next cycle
          if (this.isTransientError(error)) {
            console.warn('[auth] Keeping existing session despite transient refresh failure')
            return this.session
          }
          this.session = null
          this.clearStoredSession()
          return null
        }
      }
      return this.session
    }

    this.refreshInFlight = doRefresh().finally(() => {
      this.refreshInFlight = null
    })
    return this.refreshInFlight
  }

  async ensureValidSession(minValidityMs = 5 * 60 * 1000): Promise<AuthSession | null> {
    // No session to ensure
    if (!this.session) return null
    // Refresh if expired or expiring soon
    if (this.isExpiringSoon(minValidityMs)) {
      return await this.refreshTokens()
    }
    return this.session
  }

  async requestPasswordReset(email: string): Promise<void> {
    // Ensure config is loaded
    if (!this.updateConfig()) {
      throw new Error('Configuration not loaded. Please refresh the page.');
    }

    try {
      const command = new ForgotPasswordCommand({
        ClientId: this.clientId,
        Username: email.toLowerCase(),
      })

      await this.client.send(command)
    } catch (error) {
      console.error('Password reset request error:', error)
      throw new Error('Failed to request password reset. Please check your email address.')
    }
  }

  async confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
    // Ensure config is loaded
    if (!this.updateConfig()) {
      throw new Error('Configuration not loaded. Please refresh the page.');
    }

    try {
      const command = new ConfirmForgotPasswordCommand({
        ClientId: this.clientId,
        Username: email.toLowerCase(),
        ConfirmationCode: code,
        Password: newPassword,
      })

      await this.client.send(command)
    } catch (error) {
      console.error('Password reset confirmation error:', error)
      throw new Error('Failed to reset password. Please check your code and try again.')
    }
  }

}

export const authService = new AuthService()
