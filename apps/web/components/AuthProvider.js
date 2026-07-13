'use client'
import { createContext, useContext, useState, useEffect } from 'react'
import { api } from '../lib/api.js'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('agentmarket_token')
    if (token) {
      api.me()
        .then((u) => {
          if (!u?.id && !u?.email) {
            localStorage.removeItem('agentmarket_token')
            setUser(null)
          } else {
            setUser(u)
          }
          setLoading(false)
        })
        .catch(() => {
          localStorage.removeItem('agentmarket_token')
          setUser(null)
          setLoading(false)
        })
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email, password, options = {}) => {
    let token
    if (options.register) {
      ;({ token } = await api.register(options.name, email, password, options.invite_token))
    } else {
      ;({ token } = await api.login(email, password))
    }
    localStorage.setItem('agentmarket_token', token)
    const u = await api.me()
    setUser(u)
    return u
  }

  const switchWorkspace = async (workspace_id) => {
    const { token, workspace } = await api.switchWorkspace(workspace_id)
    localStorage.setItem('agentmarket_token', token)
    // Refresh user with new workspace context
    const u = await api.me()
    setUser(u)
    return u
  }

  const logout = async () => {
    await api.logout().catch(() => {})
    localStorage.removeItem('agentmarket_token')
    setUser(null)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser, switchWorkspace }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
