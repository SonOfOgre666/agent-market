'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AppLayout from '../../../components/AppLayout.js'
import GoogleInsightsPanel from '../../../components/ads/GoogleInsightsPanel.js'
import MetaInsightsPanel from '../../../components/ads/MetaInsightsPanel.js'
import { api } from '../../../lib/api.js'
import { useToast } from '../../../components/Toast.js'
import { BarChart3, TrendingUp } from 'lucide-react'

export default function AdsPerformancePage() {
  const [accounts, setAccounts] = useState([])
  const [accountId, setAccountId] = useState('')
  const toast = useToast()

  const selected = accounts.find((a) => a.account_id === accountId)
  const isGoogle = selected?.provider === 'google_ads'
  const isMeta = selected?.provider === 'meta_ads'

  useEffect(() => {
    api
      .adAccounts()
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : rows?.items || []
        setAccounts(list)
        if (list.length) setAccountId(list[0].account_id)
      })
      .catch((e) => toast.error(e.message))
  }, [])

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <TrendingUp size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Ads Performance</h1>
          </div>
          <p className="page-header-desc">
            Live ad metrics from your connected Google Ads and Meta Ads accounts.
          </p>
        </div>
        <Link href="/ads/campaigns" className="btn btn-secondary">
          <BarChart3 size={14} strokeWidth={2} /> Campaigns
        </Link>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            className="form-input"
            style={{ minWidth: 260 }}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.length === 0 && <option value="">No ads accounts connected</option>}
            {accounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.ad_account_name || a.account_name} (
                {a.provider === 'google_ads' ? 'Google Ads' : 'Meta Ads'})
              </option>
            ))}
          </select>
          {isMeta && (
            <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
              Click Load insights to fetch metrics.
            </span>
          )}
          {isGoogle && (
            <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>
              Click Run report to fetch metrics.
            </span>
          )}
        </div>
      </div>

      {accounts.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--fg-muted)' }}>
          Connect a Google Ads or Meta Ads account under{' '}
          <Link href="/accounts" style={{ color: 'var(--primary)' }}>
            Accounts
          </Link>{' '}
          to view live performance.
        </div>
      ) : isGoogle ? (
        <GoogleInsightsPanel
          connection={selected}
          onToast={(msg, type) => (type === 'error' ? toast.error(msg) : toast.success(msg))}
        />
      ) : isMeta ? (
        <MetaInsightsPanel
          connection={selected}
          onToast={(msg, type) => (type === 'error' ? toast.error(msg) : toast.success(msg))}
        />
      ) : (
        <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--fg-muted)' }}>
          Select a Google Ads or Meta Ads account above.
        </div>
      )}
    </AppLayout>
  )
}
