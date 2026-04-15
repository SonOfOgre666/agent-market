'use client'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import AppLayout from '../../../components/AppLayout.js'
import { api } from '../../../lib/api.js'
import { useToast } from '../../../components/Toast.js'

const PROVIDER_LABEL = { facebook: 'Facebook Page', instagram: 'Instagram Account' }

function EntitiesContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const toast = useToast()

  const provider = searchParams.get('provider') || 'facebook'
  const parentKey = searchParams.get('parent_key') || ''

  const [entities, setEntities] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null)

  useEffect(() => {
    api.accountEntities(provider, parentKey)
      .then(setEntities)
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [provider, parentKey])

  const connect = async (entity) => {
    setSaving(entity.id)
    try {
      await api.saveEntity(provider, entity, parentKey)
      toast.success(`${entity.name} connected`)
      router.push('/accounts')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(null)
    }
  }

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Select Account</h1>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <p className="text-muted text-sm" style={{ marginBottom: '1rem' }}>
          Select the {provider === 'facebook' ? 'Facebook Page' : 'Instagram account'} you want to connect.
        </p>

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 56, borderRadius: 8 }} />)}
          </div>
        ) : !entities.length ? (
          <div className="empty-state" style={{ padding: '2rem' }}>
            <div className="empty-title">No accounts found</div>
            <div className="empty-desc">
              Make sure your Facebook account manages at least one Page.
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {entities.map(entity => (
              <div key={entity.id} className="flex items-center gap-3 card card-sm" style={{ cursor: 'pointer' }}
                onClick={() => connect(entity)}>
                {entity.media?.avatar
                  ? <img src={entity.media.avatar} className="avatar" alt="" />
                  : <div className="avatar">{entity.name?.[0]}</div>}
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{entity.name}</div>
                  <div className="text-xs text-muted">
                    {PROVIDER_LABEL[entity.type] || entity.type}
                    {entity.username ? ` · @${entity.username}` : ''}
                  </div>
                </div>
                {saving === entity.id
                  ? <span className="spinner" />
                  : <span className="btn btn-primary btn-sm">Connect</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

export default function AccountEntitiesPage() {
  return (
    <Suspense fallback={<AppLayout><div className="skeleton" style={{ height: 300, borderRadius: 12 }} /></AppLayout>}>
      <EntitiesContent />
    </Suspense>
  )
}
