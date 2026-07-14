'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from './AuthProvider.js'
import { isWorkspaceAdmin } from '../lib/workspaceRoles.js'
import NotificationBell from './NotificationBell.js'
import AgentAssistant from './AgentAssistant.js'
import BrandLogo from './BrandLogo.js'
import {
  LayoutDashboard,
  FileText,
  Calendar,
  Image,
  BarChart3,
  Target,
  TrendingUp,
  Users,
  Settings,
  Menu,
  Sparkles,
  Briefcase,
  Megaphone,
  Shield,
  Globe,
  UserCheck,
  // Search,
} from 'lucide-react'

const NAV = [
  { section: 'Workspace', href: '/', label: 'Overview', icon: LayoutDashboard },
  { section: 'Workspace', href: '/posts', label: 'Posts', icon: FileText },
  { section: 'Workspace', href: '/calendar', label: 'Calendar', icon: Calendar },
  { section: 'Workspace', href: '/media', label: 'Media', icon: Image },
  { section: 'Workspace', href: '/reports', label: 'Reports', icon: BarChart3 },
  { section: 'Marketing', href: '/ads', label: 'Ads', icon: Target },
  { section: 'Marketing', href: '/ads/performance', label: 'Ads Performance', icon: TrendingUp },
  { section: 'Marketing', href: '/landing-pages', label: 'Landing Pages', icon: Globe },
  // { section: 'Marketing', href: '/seo', label: 'SEO', icon: Search },
  { section: 'Marketing', href: '/leads', label: 'Leads', icon: UserCheck },
  // { section: 'Marketing', href: '/budget', label: 'Budget', icon: Wallet },
  { section: 'Operations', href: '/accounts', label: 'Accounts', icon: Users },
  { section: 'Operations', href: '/integrations', label: 'Integrations', icon: Settings, adminOnly: true },
  { section: 'Operations', href: '/ai-integrations', label: 'AI Integrations', icon: Sparkles, adminOnly: true },
  { section: 'Operations', href: '/team', label: 'Team', icon: Briefcase },
  { section: 'Operations', href: '/preferences', label: 'Preferences', icon: Shield, adminOnly: true },
]

const SECTION_ICONS = {
  Workspace: Sparkles,
  Marketing: Megaphone,
  Operations: Briefcase,
}

/** Longest nav prefix wins — e.g. /ads/performance highlights Ads Performance, not Ads. */
function findNavMatch(pathname, nav = NAV) {
  const exact = nav.find(item => item.href === pathname)
  if (exact) return exact

  let best = null
  for (const item of nav) {
    if (item.href === '/') continue
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
      if (!best || item.href.length > best.href.length) best = item
    }
  }
  return best
}

function isNavLinkActive(pathname, href) {
  if (href === '/') return pathname === '/'
  return findNavMatch(pathname)?.href === href
}

function getCurrentLabel(pathname) {
  return findNavMatch(pathname)?.label ?? 'Overview'
}

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

  if (loading || !user) return <div className="flex-center" style={{ height: '100vh' }}><div className="spinner" /></div>

  const currentLabel = getCurrentLabel(pathname)
  const sections = ['Workspace', 'Marketing', 'Operations']
  const workspaceRole = user?.workspace?.role
  const visibleNav = NAV.filter(item => !item.adminOnly || isWorkspaceAdmin(workspaceRole))

  return (
    <div className="layout-wrapper">
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar${sidebarOpen ? ' sidebar--mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">
            <BrandLogo size={32} className="sidebar-logo-icon" />
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
          {sections.map(section => {
            const SectionIcon = SECTION_ICONS[section]
            return (
              <div key={section}>
                <div className="sidebar-nav-label" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <SectionIcon size={12} strokeWidth={2.2} />
                  {section}
                </div>
                {visibleNav.filter(item => item.section === section).map(item => {
                  const Icon = item.icon
                  return (
                    <Link key={item.href} href={item.href} className={`sidebar-nav-link${isNavLinkActive(pathname, item.href) ? ' active' : ''}`}>
                      <Icon size={16} strokeWidth={2} />
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            )
          })}
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
            <Menu size={20} strokeWidth={2} />
          </button>
          <div className="topbar-title-wrap">
            <div className="topbar-title">{currentLabel}</div>
            <div className="topbar-subtitle">{user.workspace?.name || 'Workspace'}</div>
          </div>
          <div style={{ flex: 1 }} />
          <NotificationBell />
        </header>
        <main className="layout-content">
          <div className="layout-content-shell">{children}</div>
        </main>
      </div>
      <AgentAssistant />
    </div>
  )
}
