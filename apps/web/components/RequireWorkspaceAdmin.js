'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from './AuthProvider.js'
import { isWorkspaceAdmin } from '../lib/workspaceRoles.js'
import AppLayout from './AppLayout.js'

/** Redirect non-admin workspace members away from admin-only pages. */
export default function RequireWorkspaceAdmin({ children }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const allowed = isWorkspaceAdmin(user?.workspace?.role)

  useEffect(() => {
    if (!loading && user && !allowed) router.replace('/')
  }, [loading, user, allowed, router])

  if (loading || !user) {
    return (
      <AppLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
          <div className="spinner" />
        </div>
      </AppLayout>
    )
  }

  if (!allowed) {
    return (
      <AppLayout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50vh' }}>
          <div className="spinner" />
        </div>
      </AppLayout>
    )
  }

  return children
}
