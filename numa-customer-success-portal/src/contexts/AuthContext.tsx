import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react'
import { authService, User, AuthSession, PasswordChangeRequired, MfaSetupRequired, MfaCodeRequired } from '@/services/authService'

interface AuthContextType {
  user: User | null
  session: AuthSession | null
  loading: boolean
  error: string | null
  passwordChangeRequired: PasswordChangeRequired | null
  mfaSetupRequired: MfaSetupRequired | null
  mfaCodeRequired: MfaCodeRequired | null
  signIn: (email: string, password: string) => Promise<void>
  completePasswordChange: (newPassword: string, fullName: string) => Promise<void>
  completeMfaSetup: (code: string) => Promise<void>
  submitMfaCode: (code: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  confirmPasswordReset: (email: string, code: string, newPassword: string) => Promise<void>
  signOut: () => Promise<void>
  isAuthenticated: boolean
  hasRole: (role: string) => boolean
  clearError: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [passwordChangeRequired, setPasswordChangeRequired] = useState<PasswordChangeRequired | null>(null)
  const [mfaSetupRequired, setMfaSetupRequired] = useState<MfaSetupRequired | null>(null)
  const [mfaCodeRequired, setMfaCodeRequired] = useState<MfaCodeRequired | null>(null)
  // Use a ref for the interval id to avoid re-render loops caused by changing dependencies
  const refreshTimerRef = useRef<number | null>(null)

  const signIn = async (email: string, password: string) => {
    setLoading(true)
    setError(null)
    setPasswordChangeRequired(null)

    try {
      const result = await authService.signIn(email, password)

      if ('requiresPasswordChange' in result) {
        // Password change is required
        setPasswordChangeRequired(result)
      } else if ('requiresMfaSetup' in result) {
        // User must enroll TOTP
        setMfaSetupRequired(result)
      } else if ('requiresMfaCode' in result) {
        // User must provide TOTP code
        setMfaCodeRequired(result)
      } else {
        // Successful authentication
        setSession(result)
        // Kick off background refresh loop
        startBackgroundRefresh()
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Authentication failed'
      setError(errorMessage)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const completePasswordChange = async (newPassword: string, fullName: string) => {
    if (!passwordChangeRequired) {
      throw new Error('No password change session available')
    }

    setLoading(true)
    setError(null)

    try {
      const result = await authService.completePasswordChange(
        passwordChangeRequired.session,
        passwordChangeRequired.username,
        newPassword,
        fullName
      )

      if ('requiresMfaSetup' in result) {
        setMfaSetupRequired(result)
        setMfaCodeRequired(null)
      } else if ('requiresMfaCode' in result) {
        setMfaCodeRequired(result)
      } else {
        setSession(result)
        startBackgroundRefresh()
      }
      setPasswordChangeRequired(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Password change failed'
      setError(errorMessage)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const completeMfaSetup = async (code: string) => {
    if (!mfaSetupRequired) {
      throw new Error('No MFA setup session available')
    }

    setLoading(true)
    setError(null)

    try {
      const authSession = await authService.completeMfaSetupAndSignIn(
        mfaSetupRequired.username,
        mfaSetupRequired.session,
        code,
      )
      setSession(authSession)
      setMfaSetupRequired(null)
      setMfaCodeRequired(null)
      startBackgroundRefresh()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'MFA setup failed'
      setError(errorMessage)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const submitMfaCode = async (code: string) => {
    if (!mfaCodeRequired) {
      throw new Error('No MFA challenge session available')
    }

    setLoading(true)
    setError(null)

    try {
      const authSession = await authService.respondToMfaCodeAndSignIn(
        mfaCodeRequired.username,
        mfaCodeRequired.session,
        code,
      )
      setSession(authSession)
      setMfaSetupRequired(null)
      setMfaCodeRequired(null)
      startBackgroundRefresh()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid MFA code'
      setError(errorMessage)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const signOut = async () => {
    setLoading(true)
    setError(null)

    try {
      await authService.signOut()
      setSession(null)
      setPasswordChangeRequired(null)
      // Stop background refresh loop
      stopBackgroundRefresh()
      setMfaSetupRequired(null)
      setMfaCodeRequired(null)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Sign out failed'
      setError(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const requestPasswordReset = async (email: string) => {
    setLoading(true)
    setError(null)

    try {
      await authService.requestPasswordReset(email)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Password reset request failed'
      setError(errorMessage)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const confirmPasswordReset = async (email: string, code: string, newPassword: string) => {
    setLoading(true)
    setError(null)

    try {
      await authService.confirmPasswordReset(email, code, newPassword)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Password reset confirmation failed'
      setError(errorMessage)
      throw err
    } finally {
      setLoading(false)
    }
  }

  const clearError = () => setError(null)

  const hasRole = (role: string): boolean => {
    return authService.hasRole(role)
  }

  // Background refresh loop (every 30s) to keep tokens fresh
  const stopBackgroundRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      window.clearInterval(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
  }, [])

  const startBackgroundRefresh = useCallback(() => {
    stopBackgroundRefresh()
    const id = window.setInterval(async () => {
      const ensured = await authService.ensureValidSession(5 * 60 * 1000)
      // Only update session state if we got a result (null means logged out by permanent error)
      // If ensured is the same object reference (transient failure kept session), skip re-render
      if (ensured !== null) {
        setSession(ensured)
      } else {
        // Permanent failure — clear session in context to trigger login screen
        setSession(null)
      }
    }, 30000)
    refreshTimerRef.current = id
  }, [stopBackgroundRefresh])

  // Visibility change handler — refresh tokens when user returns to the tab
  // Uses a 2-second debounce to avoid false logouts from laptop wake-up network delays
  const visibilityDebounceRef = useRef<number | null>(null)

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      if (!authService.getCurrentSession()) return

      // Clear any pending debounce
      if (visibilityDebounceRef.current) {
        window.clearTimeout(visibilityDebounceRef.current)
      }

      visibilityDebounceRef.current = window.setTimeout(async () => {
        visibilityDebounceRef.current = null

        // If offline, wait for the browser to come back online before refreshing
        if (!navigator.onLine) {
          const onlineHandler = async () => {
            window.removeEventListener('online', onlineHandler)
            const ensured = await authService.ensureValidSession(5 * 60 * 1000)
            if (ensured) setSession(ensured)
          }
          window.addEventListener('online', onlineHandler)
          return
        }

        const ensured = await authService.ensureValidSession(5 * 60 * 1000)
        if (ensured) setSession(ensured)
      }, 2000) // 2-second debounce for network to stabilize after wake
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (visibilityDebounceRef.current) {
        window.clearTimeout(visibilityDebounceRef.current)
      }
    }
  }, [])

  // Check for existing session on mount
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        const existing = authService.getCurrentSession()
        if (existing) {
          // Ensure tokens are valid or refresh if needed
          const ensured = await authService.ensureValidSession(5 * 60 * 1000)
          if (!cancelled) {
            setSession(ensured)
            if (ensured) startBackgroundRefresh()
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    return () => {
      cancelled = true
      stopBackgroundRefresh()
    }
  }, [startBackgroundRefresh, stopBackgroundRefresh])

  const value: AuthContextType = {
    user: session?.user || null,
    session,
    loading,
    error,
    passwordChangeRequired,
    mfaSetupRequired,
    mfaCodeRequired,
    signIn,
    completePasswordChange,
    completeMfaSetup,
    submitMfaCode,
    requestPasswordReset,
    confirmPasswordReset,
    signOut,
    isAuthenticated: session !== null,
    hasRole,
    clearError,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export default AuthContext
