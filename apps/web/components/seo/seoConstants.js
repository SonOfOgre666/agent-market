export const SEO_COLORS = {
  audit: '#10b981',
  keywords: '#3b82f6',
  competitors: '#8b5cf6',
  rankings: '#f97316',
}

export const INTENT_COLOR = {
  informational: '#6366f1',
  transactional: '#10b981',
  navigational: '#0ea5e9',
  commercial: '#f59e0b',
  comparison: '#ec4899',
}

export const SEVERITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: '#94a3b8' }

export const PRIORITY_COLOR = { high: '#ef4444', medium: '#f59e0b', low: 'var(--fg-muted)' }

export const SEO_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'audit', label: 'Audit' },
  { id: 'keywords', label: 'Keywords' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'rankings', label: 'Rank Tracking' },
]

export const WORKFLOW_STEPS = [
  { step: 1, label: 'Audit Website', tab: 'audit', color: SEO_COLORS.audit },
  { step: 2, label: 'Find Issues', tab: 'audit', color: SEO_COLORS.audit },
  { step: 3, label: 'Research Competitors', tab: 'competitors', color: SEO_COLORS.competitors },
  { step: 4, label: 'Discover Keywords', tab: 'keywords', color: SEO_COLORS.keywords },
  { step: 5, label: 'Generate Optimizations', tab: 'audit', color: SEO_COLORS.audit },
  { step: 6, label: 'Track Rankings', tab: 'rankings', color: SEO_COLORS.rankings },
]

export function formatRelativeTime(date) {
  if (!date) return ''
  const d = new Date(date)
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return hrs === 1 ? 'Yesterday' : `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'Last week'
  return d.toLocaleDateString()
}

export function scoreLabel(score) {
  if (score == null) return '—'
  if (score >= 90) return 'Excellent'
  if (score >= 70) return 'Good'
  if (score >= 50) return 'Needs work'
  return 'Poor'
}

export function scoreEmoji(score) {
  if (score == null) return '—'
  if (score >= 90) return '✓'
  if (score >= 70) return '⚠'
  return '❌'
}
