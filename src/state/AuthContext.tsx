import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as api from '../lib/auth/api.ts'
import { clearPersonalData, getSession, onSessionRejected, setSession } from '../lib/auth/session.ts'
import { useToast } from '../motion/Toast.jsx'
import type { AtlasUser, AuthSession } from '../lib/auth/types.ts'

// Who is signed in. One URL for everyone: the role decides the landing screen.
// stage: checking (first look) | setup (no accounts yet, stand-in only) |
// signedOut | mustChange (temp password, must pick a new one) | signedIn.
export type AuthStage = 'checking' | 'setup' | 'signedOut' | 'mustChange' | 'signedIn'

interface AuthValue {
  stage: AuthStage
  user: AtlasUser | null
  token: string | null
  local: boolean
  signIn: (email: string, password: string) => Promise<void>
  changePassword: (current: string, next: string) => Promise<void>
  signOut: () => Promise<void>
  setUp: (email: string, name: string, password: string) => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

const stageFor = (s: AuthSession | null): AuthStage =>
  !s ? 'signedOut' : s.user.mustChangePassword ? 'mustChange' : 'signedIn'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setState] = useState<AuthSession | null>(getSession)
  const [stage, setStage] = useState<AuthStage>(() => (getSession() ? stageFor(getSession()) : 'checking'))

  const keep = useCallback((next: AuthSession | null) => {
    setSession(next)
    setState(next)
    setStage(stageFor(next))
  }, [])

  // Signed out: see whether the first admin still has to be set up.
  useEffect(() => {
    if (stage !== 'checking') return
    let live = true
    api.needsSetup()
      .then((empty) => { if (live) setStage(empty ? 'setup' : 'signedOut') })
      .catch(() => { if (live) setStage('signedOut') })
    return () => { live = false }
  }, [stage])

  // The token runs out after 12 hours: back to sign-in, without a reload.
  useEffect(() => {
    if (!session) return undefined
    const ms = Date.parse(session.expiresAt) - Date.now()
    const t = window.setTimeout(() => { clearPersonalData(); keep(null) }, Math.max(0, Math.min(ms, 2 ** 31 - 1)))
    return () => window.clearTimeout(t)
  }, [session, keep])

  // The flows refused the token before it ran out here (most often a sign-in on
  // another device or on the UAT page, which share the accounts): back to sign-in.
  const toast = useToast() as (message: string, tone?: string) => void
  useEffect(() => onSessionRejected(() => {
    clearPersonalData()
    keep(null)
    toast('Your sign-in ended, maybe because you signed in on another device or page. Sign in again to load bookings.', 'error')
  }), [keep, toast])

  const signIn = useCallback(async (email: string, password: string) => {
    keep(await api.signIn(email, password))
  }, [keep])

  const changePassword = useCallback(async (current: string, next: string) => {
    if (!session) return
    await api.changePassword(session.token, session.user.email, current, next)
    keep({ ...session, user: { ...session.user, mustChangePassword: false } })
  }, [session, keep])

  const signOut = useCallback(async () => {
    const token = session?.token
    clearPersonalData()
    keep(null)
    // The flow clears its copy too; if it can't be reached the token still runs out.
    if (token) await api.signOut(token).catch(() => {})
  }, [session, keep])

  const setUp = useCallback(async (email: string, name: string, password: string) => {
    await api.bootstrap(email, name, password)
    keep(await api.signIn(email, password))
  }, [keep])

  const value = useMemo<AuthValue>(() => ({
    stage, user: session?.user ?? null, token: session?.token ?? null, local: api.LOCAL_AUTH,
    signIn, changePassword, signOut, setUp,
  }), [stage, session, signIn, changePassword, signOut, setUp])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
