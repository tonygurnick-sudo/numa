import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { authService, User, AuthSession, PasswordChangeRequired } from '@/services/authService'

interface AuthContextType {
  user: User | null
  session: AuthSession | null
  loading: boolean
  error: string | null
  passwordChangeRequired: PasswordChangeRequired | null
  signIn: (email: string, password: string) => Promise<void>
  completePasswordChange: (newPassword: string, fullName: string) => Promise<void>
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
  const [refreshTimerId, setRefreshTimerId] = useState<number | null>(null)

  const signIn = async (email: string, password: string) => {
    setLoading(true)
    setError(null)
    setPasswordChangeRequired(null)

    try {
      const result = await authService.signIn(email, password)

      if ('requiresPasswordChange' in result) {
        // Password change is required
        setPasswordChangeRequired(result)
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
      const authSession = await authService.completePasswordChange(
        passwordChangeRequired.session,
        passwordChangeRequired.username,
        newPassword,
        fullName
      )

      setSession(authSession)
      setPasswordChangeRequired(null)
      // Kick off background refresh loop
      startBackgroundRefresh()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Password change failed'
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

  // Background refresh loop (every 30s) to keep tokens fresh
  const stopBackgroundRefresh = useCallback(() => {
    if (refreshTimerId) {
      window.clearInterval(refreshTimerId)
      setRefreshTimerId(null)
    }
  }, [refreshTimerId])

  const startBackgroundRefresh = useCallback(() => {
    stopBackgroundRefresh()
    const id = window.setInterval(async () => {
      const ensured = await authService.ensureValidSession(5 * 60 * 1000)
      setSession(ensured)
    }, 30000)
    setRefreshTimerId(id)
  }, [stopBackgroundRefresh])

  const value: AuthContextType = {
    user: session?.user || null,
    session,
    loading,
    error,
    passwordChangeRequired,
    signIn,
    completePasswordChange,
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
