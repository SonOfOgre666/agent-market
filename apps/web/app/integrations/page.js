'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import AppLayout from '../../components/AppLayout.js'
import RequireWorkspaceAdmin from '../../components/RequireWorkspaceAdmin.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { Plug, X, Globe, BarChart3, Image, Sparkles } from 'lucide-react'

const INTEGRATION_FIELDS = {
  twitter: [
    { key: 'client_id', label: 'API Key (Consumer Key)', type: 'text' },
    { key: 'client_secret', label: 'API Secret', type: 'password' },
    { key: 'tier', label: 'Tier', type: 'select', options: ['free', 'basic', 'pay_as_you_go', 'legacy'] },
  ],
  facebook: [
    { key: 'app_id', label: 'App ID', type: 'text' },
    { key: 'app_secret', label: 'App Secret', type: 'password' },
  ],
  instagram_login: [
    { key: 'app_id', label: 'App ID', type: 'text' },
    { key: 'app_secret', label: 'App Secret', type: 'password' },
  ],
  tiktok: [
    { key: 'client_key', label: 'Client Key', type: 'text' },
    { key: 'client_secret', label: 'Client Secret', type: 'password' },
  ],
  linkedin: [
    { key: 'client_id', label: 'Client ID', type: 'text' },
    { key: 'client_secret', label: 'Client Secret', type: 'password' },
  ],
  google_ads: [
    { key: 'client_id', label: 'OAuth2 Client ID', type: 'text' },
    { key: 'client_secret', label: 'OAuth2 Client Secret', type: 'password' },
    { key: 'developer_token', label: 'Developer Token', type: 'password' },
  ],
  unsplash: [
    { key: 'access_key', label: 'Access Key', type: 'text' },
  ],
  giphy: [
    { key: 'api_key', label: 'API Key', type: 'text' },
  ],
}

const INTEGRATION_LABELS = {
  twitter: 'Twitter/X',
  facebook: 'Facebook & Instagram (via Facebook Login)',
  instagram_login: 'Instagram (via Instagram Login)',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  google_ads: 'Google Ads',
  unsplash: 'Unsplash',
  giphy: 'Giphy',
}

const INTEGRATION_ICONS = {
  twitter: X,
  facebook: Globe,
  instagram_login: Globe,
  tiktok: Globe,
  linkedin: Globe,
  google_ads: BarChart3,
  unsplash: Image,
  giphy: Sparkles,
}

const INTEGRATION_SECTIONS = [
  {
    title: 'Social Media',
    description: 'OAuth and API credentials for publishing and imports.',
    names: ['twitter', 'facebook', 'instagram_login', 'tiktok', 'linkedin'],
  },
  {
    title: 'Advertising',
    description: 'Ad platform API keys and OAuth for campaign management.',
    names: ['google_ads'],
  },
  {
    title: 'Media Libraries',
    description: 'Stock media search inside the post editor.',
    names: ['unsplash', 'giphy'],
  },
]

function IntegrationCard({ name, fields, configs, saving, onUpdate, onSave }) {
  const Icon = INTEGRATION_ICONS[name] || Plug
  return (
    <div className="card">
      <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Icon size={16} strokeWidth={2} />
        {INTEGRATION_LABELS[name]}
      </div>
      {fields.map(field => (
        <div key={field.key} className="form-group">
          <label className="form-label">{field.label}</label>
          {field.type === 'select' ? (
            <select
              className="form-input"
              value={configs[name]?.[field.key] || ''}
              onChange={e => onUpdate(name, field.key, e.target.value)}
            >
              {field.options.map(o => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <input
              className="form-input"
              type={field.type}
              placeholder={field.placeholder || ''}
              value={configs[name]?.[field.key] || ''}
              onChange={e => onUpdate(name, field.key, e.target.value)}
            />
          )}
        </div>
      ))}
      <button
        type="button"
        className="btn btn-primary btn-sm"
        onClick={() => onSave(name)}
        disabled={saving[name]}
      >
        {saving[name] ? <span className="spinner" /> : 'Save'}
      </button>
    </div>
  )
}

export default function IntegrationsPage() {
  const [configs, setConfigs] = useState({})
  const [saving, setSaving] = useState({})
  const toast = useToast()
  const searchParams = useSearchParams()

  useEffect(() => {
    const error = searchParams.get('error')
    const connected = searchParams.get('connected')
    const provider = searchParams.get('provider')
    if (error) {
      toast.error(decodeURIComponent(error))
    } else if (connected && provider) {
      toast.success(`${INTEGRATION_LABELS[provider] || provider} connected`)
    }
  }, [searchParams, toast])

  useEffect(() => {
    api.integrations()
      .then(rows => {
        const map = {}
        for (const row of rows) map[row.name] = row.configuration || {}
        setConfigs(map)
      })
      .catch(console.error)
  }, [])

  const saveIntegration = async (name) => {
    setSaving(s => ({ ...s, [name]: true }))
    try {
      await api.saveIntegration(name, configs[name] || {})
      toast.success(`${INTEGRATION_LABELS[name]} saved`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(s => ({ ...s, [name]: false }))
    }
  }

  const update = (name, key, value) => {
    setConfigs(c => ({ ...c, [name]: { ...c[name], [key]: value } }))
  }

  return (
    <RequireWorkspaceAdmin>
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Plug size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Integrations</h1>
          </div>
          <p className="page-header-desc">Configure third-party platforms and API keys for your workspace</p>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {INTEGRATION_SECTIONS.map(section => (
          <section key={section.title}>
            <h2 className="integrations-section-title">{section.title}</h2>
            {section.description && (
              <p className="text-muted integrations-section-desc">{section.description}</p>
            )}
            <div className="integrations-section-grid">
              {section.names.map(name => {
                const fields = INTEGRATION_FIELDS[name]
                if (!fields) return null
                return (
                  <IntegrationCard
                    key={name}
                    name={name}
                    fields={fields}
                    configs={configs}
                    saving={saving}
                    onUpdate={update}
                    onSave={saveIntegration}
                  />
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </AppLayout>
    </RequireWorkspaceAdmin>
  )
}
