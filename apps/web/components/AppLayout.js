'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from './AuthProvider.js'
import NotificationBell from './NotificationBell.js'

const NAV = [
  { href: '/', label: 'Overview', icon: '▦' },
  { href: '/posts', label: 'Posts', icon: '✎' },
  { href: '/calendar', label: 'Calendar', icon: '⊟' },
  { href: '/media', label: 'Media', icon: '⬚' },
  { href: '/reports', label: 'Reports', icon: '↗' },
  { href: '/ads', label: 'Ads', icon: '◎' },
  { href: '/budget', label: 'Budget', icon: '◑' },
  { href: '/accounts', label: 'Accounts', icon: '⊙' },
  { href: '/services', label: 'Services', icon: '⚙' },
  { href: '/team', label: 'Team', icon: '◈' },
  { href: '/settings', label: 'Settings', icon: '≡' },
]

export default function AppLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, loading, logout } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!loading && !user) router.push('/login')
  }, [user, loading, router])

  // Close sidebar on route change
  useEffect(() => { setSidebarOpen(false) }, [pathname])

  if (loading || !user) return <div className="flex items-center justify-center" style={{ height: '100vh' }}><div className="spinner" /></div>

  return (
    <div className="layout-wrapper">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? ' sidebar--mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon" style={{ fontSize: '0.875rem', fontWeight: 700 }}>A</div>
            <div className="sidebar-logo-text">
              <span className="sidebar-logo-name">Agent Market</span>
              {user?.workspace?.name && (
                <span style={{ display: 'block', fontSize: '0.65rem', color: 'var(--fg-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 130 }}>
                  {user.workspace.name}
                </span>
              )}
            </div>
          </div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(item => (
            <Link key={item.href} href={item.href} className={`sidebar-nav-link${pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)) ? ' active' : ''}`}>
              <span style={{ fontSize: '1rem', width: '1.25rem', textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <Link href="/profile" className="sidebar-nav-link" style={{ marginBottom: '0.25rem' }}>
            <span className="avatar avatar-sm">{user.name?.[0]?.toUpperCase()}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{user.name}</span>
          </Link>
          <button className="btn btn-ghost btn-sm w-full" style={{ justifyContent: 'center' }} onClick={logout}>Logout</button>
        </div>
      </aside>
      <div className="layout-main">
        <header className="layout-topbar">
          <button className="topbar-hamburger" onClick={() => setSidebarOpen(o => !o)} aria-label="Menu">
            ☰
          </button>
          <div style={{ flex: 1 }} />
          <NotificationBell />
        </header>
        <main className="layout-content">{children}</main>
      </div>
    </div>
  )
}
