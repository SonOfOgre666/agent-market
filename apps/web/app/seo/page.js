'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import SeoDashboard from '../../components/seo/SeoDashboard.js'
import SeoOverview from '../../components/seo/SeoOverview.js'
import SeoLandingAuditPanel from '../../components/seo/SeoLandingAuditPanel.js'
import CompetitiveAnalysisPanel from '../../components/seo/CompetitiveAnalysisPanel.js'
import SeoKeywordTrackingPanel from '../../components/seo/SeoKeywordTrackingPanel.js'
import SeoKeywordClustersPanel from '../../components/seo/SeoKeywordClustersPanel.js'
import { buildHistoryItems } from '../../components/seo/SeoHistoryPanel.js'
import { SEO_TABS } from '../../components/seo/seoConstants.js'
import { api } from '../../lib/api.js'
import { Search } from 'lucide-react'

export default function SeoPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [statsLoading, setStatsLoading] = useState(true)
  const [audit, setAudit] = useState(null)
  const [keywordCount, setKeywordCount] = useState(0)
  const [clusterCount, setClusterCount] = useState(0)
  const [competitorCount, setCompetitorCount] = useState(0)
  const [clusters, setClusters] = useState([])
  const [competitors, setCompetitors] = useState([])
  const [rankSnapshots, setRankSnapshots] = useState([])
  const [rankAutoCheck, setRankAutoCheck] = useState(false)

  const refreshStats = useCallback(async () => {
    setStatsLoading(true)
    try {
      const [auditOut, targetsOut, clustersOut, competitorsOut, ranksOut] = await Promise.all([
        api.seoLandingPageAudit().catch(() => null),
        api.seoKeywordTargets().catch(() => ({ items: [] })),
        api.recentSeoKeywordClusters({ limit: 10 }).catch(() => ({ items: [] })),
        api.recentCompetitiveAnalyses({ limit: 10 }).catch(() => ({ items: [] })),
        api.seoRankHistory({ limit: 50 }).catch(() => ({ items: [] })),
      ])
      if (auditOut) setAudit({ ...auditOut, fetched_at: new Date().toISOString() })
      setKeywordCount((targetsOut.items || []).length)
      setClusters(clustersOut.items || [])
      setClusterCount((clustersOut.items || []).length)
      setCompetitors(competitorsOut.items || [])
      setCompetitorCount((competitorsOut.items || []).length)
      setRankSnapshots(ranksOut.items || [])
    } finally {
      setStatsLoading(false)
    }
  }, [])

  useEffect(() => { refreshStats() }, [refreshStats])

  const stats = useMemo(() => {
    if (!audit) {
      return {
        seoScore: null,
        keywordCount,
        clusterCount,
        competitorCount,
        pageCount: 0,
        issueCount: 0,
        criticalCount: 0,
        warningCount: 0,
      }
    }
    let warnings = 0
    for (const p of audit.pages || []) {
      for (const issue of p.issues || []) {
        if (issue.severity !== 'high') warnings++
      }
    }
    const issueCount = (audit.pages || []).reduce((s, p) => s + (p.issues?.length || 0), 0)
    return {
      seoScore: audit.average_score,
      keywordCount,
      clusterCount,
      competitorCount,
      pageCount: audit.page_count,
      issueCount,
      criticalCount: audit.summary?.critical ?? 0,
      warningCount: warnings,
    }
  }, [audit, keywordCount, clusterCount, competitorCount])

  const historyItems = useMemo(
    () => buildHistoryItems({ audit, clusters, competitors, rankSnapshots }),
    [audit, clusters, competitors, rankSnapshots],
  )

  function handleQuickAction(tabId) {
    if (tabId === 'rankings') {
      setRankAutoCheck(true)
      setActiveTab('rankings')
      setTimeout(() => setRankAutoCheck(false), 500)
      return
    }
    setActiveTab(tabId)
  }

  function handleHistorySelect(item) {
    if (item.type === 'audit') setActiveTab('audit')
    else if (item.type === 'cluster') setActiveTab('keywords')
    else if (item.type === 'competitor') setActiveTab('competitors')
    else if (item.type === 'rank') setActiveTab('rankings')
  }

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Search size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">SEO</h1>
          </div>
          <p className="page-header-desc">
            Monitor rankings, optimize pages, research competitors, and discover opportunities.
          </p>
        </div>
      </div>

      <SeoDashboard
        stats={stats}
        loading={statsLoading}
        onTabChange={setActiveTab}
        onQuickAction={handleQuickAction}
      />

      <div className="tabs seo-tabs">
        {SEO_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="seo-tab-content">
        {activeTab === 'overview' && (
          <SeoOverview
            historyItems={historyItems}
            onTabChange={setActiveTab}
            onHistorySelect={handleHistorySelect}
          />
        )}
        {activeTab === 'audit' && (
          <SeoLandingAuditPanel
            onAuditLoaded={(a) => {
              setAudit(a)
              refreshStats()
            }}
          />
        )}
        {activeTab === 'keywords' && (
          <SeoKeywordClustersPanel onResult={() => refreshStats()} />
        )}
        {activeTab === 'competitors' && (
          <CompetitiveAnalysisPanel onResult={() => refreshStats()} />
        )}
        {activeTab === 'rankings' && (
          <SeoKeywordTrackingPanel autoCheck={rankAutoCheck} />
        )}
      </div>
    </AppLayout>
  )
}
