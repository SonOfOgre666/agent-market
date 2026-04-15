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
      api.me().then(u => { setUser(u); setLoading(false) }).catch(() => { setLoading(false) })
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email, password, options = {}) => {
    // If register option is true, call register endpoint
    if (options.register) {
      const { token, user: u } = await api.register(options.name, email, password, options.invite_token)
      localStorage.setItem('agentmarket_token', token)
      setUser(u)
      return u
    }

    // Normal login
    const { token, user: u } = await api.login(email, password)
    localStorage.setItem('agentmarket_token', token)
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
