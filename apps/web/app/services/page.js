'use client'
import { useEffect, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'

const SERVICE_FIELDS = {
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
  mastodon: [
    { key: 'server_url', label: 'Server URL', type: 'text', placeholder: 'https://mastodon.social' },
    { key: 'client_id', label: 'Client ID', type: 'text' },
    { key: 'client_secret', label: 'Client Secret', type: 'password' },
  ],
  unsplash: [
    { key: 'access_key', label: 'Access Key', type: 'text' },
  ],
  giphy: [
    { key: 'api_key', label: 'API Key', type: 'text' },
  ],
}

const SERVICE_LABELS = {
  twitter: 'Twitter / X',
  facebook: 'Facebook & Instagram (via Facebook Login)',
  instagram_login: 'Instagram (via Instagram Login)',
  tiktok: 'TikTok',
  linkedin: 'LinkedIn',
  google_ads: 'Google Ads',
  mastodon: 'Mastodon',
  unsplash: 'Unsplash',
  giphy: 'Giphy GIFs',
}

export default function ServicesPage() {
  const [configs, setConfigs] = useState({})
  const [saving, setSaving] = useState({})
  const [mastodonServer, setMastodonServer] = useState('')
  const toast = useToast()

  useEffect(() => {
    api.services().then(services => {
      const map = {}
      for (const s of services) map[s.name] = s.configuration || {}
      setConfigs(map)
    }).catch(console.error)
  }, [])

  const saveService = async (name) => {
    setSaving(s => ({ ...s, [name]: true }))
    try {
      await api.saveService(name, configs[name] || {})
      toast.success(`${SERVICE_LABELS[name]} saved`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(s => ({ ...s, [name]: false }))
    }
  }

  const createMastodonApp = async () => {
    if (!mastodonServer) return toast.error('Enter a server URL first')
    try {
      const data = await api.createMastodonApp(mastodonServer)
      setConfigs(c => ({ ...c, mastodon: { ...c.mastodon, ...data } }))
      toast.success('Mastodon app created')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const update = (name, key, value) => {
    setConfigs(c => ({ ...c, [name]: { ...c[name], [key]: value } }))
  }

  return (
    <AppLayout>
      <div className="page-header"><h1 className="page-title">Services</h1></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {Object.entries(SERVICE_FIELDS).map(([name, fields]) => (
          <div key={name} className="card">
            <div className="card-title">{SERVICE_LABELS[name]}</div>
            {fields.map(field => (
              <div key={field.key} className="form-group">
                <label className="form-label">{field.label}</label>
                {field.type === 'select' ? (
                  <select className="form-input" value={configs[name]?.[field.key] || ''} onChange={e => update(name, field.key, e.target.value)}>
                    {field.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input className="form-input" type={field.type} placeholder={field.placeholder || ''} value={configs[name]?.[field.key] || ''} onChange={e => update(name, field.key, e.target.value)} />
                )}
              </div>
            ))}
            {name === 'mastodon' && (
              <div className="flex gap-2" style={{ marginBottom: '1rem' }}>
                <input className="form-input" placeholder="https://mastodon.social" value={mastodonServer} onChange={e => setMastodonServer(e.target.value)} />
                <button className="btn btn-secondary" onClick={createMastodonApp}>Create App</button>
              </div>
            )}
            <button className="btn btn-primary btn-sm" onClick={() => saveService(name)} disabled={saving[name]}>
              {saving[name] ? <span className="spinner" /> : 'Save'}
            </button>
          </div>
        ))}
      </div>
    </AppLayout>
  )
}
