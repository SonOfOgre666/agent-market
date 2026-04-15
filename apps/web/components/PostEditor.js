'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '../lib/api.js'
import { useToast } from './Toast.js'
import MediaPicker from './MediaPicker.js'
import { format } from 'date-fns'

const PROVIDER_LIMITS = {
  twitter: 280, facebook: 5000, instagram: 2200,
  instagram_login: 2200, mastodon: 500, tiktok: 150, linkedin: 3000,
}

const PLATFORM_INFO = {
  facebook:        { label: 'Facebook',        color: '#1877f2', icon: 'f',  mediaRequired: false, supportsLink: true,  supportsTargeting: true,  supportsStory: false },
  instagram:       { label: 'Instagram',       color: '#e1306c', icon: 'ig', mediaRequired: true,  supportsLink: false, supportsTargeting: false, supportsStory: true  },
  instagram_login: { label: 'Instagram',       color: '#e1306c', icon: 'ig', mediaRequired: true,  supportsLink: false, supportsTargeting: false, supportsStory: true  },
  twitter:         { label: 'X / Twitter',     color: '#1d9bf0', icon: 'x',  mediaRequired: false, supportsLink: true,  supportsTargeting: false, supportsStory: false },
  mastodon:        { label: 'Mastodon',        color: '#6364ff', icon: 'm',  mediaRequired: false, supportsLink: true,  supportsTargeting: false, supportsStory: false },
  tiktok:          { label: 'TikTok',          color: '#ff0050', icon: 'tt', mediaRequired: true,  supportsLink: false, supportsTargeting: false, supportsStory: false, videoOnly: true },
  linkedin:        { label: 'LinkedIn',        color: '#0a66c2', icon: 'in', mediaRequired: false, supportsLink: true,  supportsTargeting: false, supportsStory: false },
}

const INSTAGRAM_PROVIDERS = ['instagram', 'instagram_login']

// ISO 3166-1 alpha-2 country list (abbreviated)
const COUNTRIES = [
  ['US','United States'],['GB','United Kingdom'],['CA','Canada'],['AU','Australia'],
  ['DE','Germany'],['FR','France'],['ES','Spain'],['IT','Italy'],['NL','Netherlands'],
  ['BR','Brazil'],['MX','Mexico'],['AR','Argentina'],['IN','India'],['JP','Japan'],
  ['KR','South Korea'],['CN','China'],['RU','Russia'],['ZA','South Africa'],
  ['NG','Nigeria'],['EG','Egypt'],['SA','Saudi Arabia'],['AE','UAE'],['TR','Turkey'],
  ['PL','Poland'],['SE','Sweden'],['NO','Norway'],['DK','Denmark'],['FI','Finland'],
  ['PT','Portugal'],['BE','Belgium'],['CH','Switzerland'],['AT','Austria'],
  ['MA','Morocco'],['DZ','Algeria'],['TN','Tunisia'],
]

function getPlatformWarnings(provider, mediaItems, charCount, charLimit, isStory) {
  const warnings = []
  const info = PLATFORM_INFO[provider]
  if (!info) return warnings

  const hasMedia = mediaItems.length > 0
  const hasVideo = mediaItems.some(m => m.mime_type?.startsWith('video'))
  const hasImage = mediaItems.some(m => m.mime_type && !m.mime_type.startsWith('video'))

  if (INSTAGRAM_PROVIDERS.includes(provider)) {
    if (!hasMedia) {
      warnings.push({ level: 'error', msg: 'Requires at least one image or video' })
    } else {
      mediaItems.forEach(m => {
        if (m.mime_type?.startsWith('video')) return
        if (m.mime_type && !['image/jpeg', 'image/jpg'].includes(m.mime_type)) {
          warnings.push({ level: 'error', msg: `"${m.name}" must be JPEG (PNG not supported)` })
        }
        if (m.size && m.size > 8 * 1024 * 1024) {
          warnings.push({ level: 'error', msg: `"${m.name}" exceeds 8 MB limit` })
        }
        if (m.width && m.height) {
          const ratio = m.width / m.height
          if (ratio < 0.8 || ratio > 1.91) {
            warnings.push({ level: 'error', msg: `Aspect ratio ${ratio.toFixed(2)}:1 out of range (4:5 – 1.91:1)` })
          }
        }
      })
      if (isStory && mediaItems.length > 1) {
        warnings.push({ level: 'warning', msg: 'Stories support only 1 media item' })
      }
    }
  }

  if (provider === 'tiktok') {
    if (!hasVideo) warnings.push({ level: 'error', msg: 'TikTok requires a video (MP4 or MOV)' })
    else if (hasImage) warnings.push({ level: 'warning', msg: 'Remove images — TikTok supports video only' })
  }

  if (provider === 'twitter' && mediaItems.length > 4) {
    warnings.push({ level: 'warning', msg: 'Twitter supports max 4 media items' })
  }
  if (provider === 'linkedin' && !hasVideo && mediaItems.length > 9) {
    warnings.push({ level: 'warning', msg: 'LinkedIn supports max 9 images' })
  }

  if (charCount > charLimit) {
    warnings.push({ level: 'error', msg: `Text too long (${charCount}/${charLimit} chars)` })
  } else if (charCount > charLimit * 0.9) {
    warnings.push({ level: 'warning', msg: `Approaching character limit (${charCount}/${charLimit})` })
  }

  return warnings
}

export default function PostEditor({ postId }) {
  const router = useRouter()
  const toast = useToast()
  const isEdit = !!postId

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [accounts, setAccounts] = useState([])
  const [tags, setTags] = useState([])
  const [selectedAccounts, setSelectedAccounts] = useState([])
  const [selectedTags, setSelectedTags] = useState([])
  const [versions, setVersions] = useState([{ account_id: null, is_original: true, content: [{ type: 'text', body: '' }] }])
  const [activeVersion, setActiveVersion] = useState(null)
  const [scheduledAt, setScheduledAt] = useState('')
  const [isStory, setIsStory] = useState(false)
  const [showMediaPicker, setShowMediaPicker] = useState(false)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [showTargeting, setShowTargeting] = useState(false)
  const [showFirstComment, setShowFirstComment] = useState(false)
  const [showGuide, setShowGuide] = useState(true)

  useEffect(() => {
    const init = async () => {
      const data = isEdit ? await api.post(postId) : await api.posts({ per_page: 1 })
      const baseData = isEdit ? data : null
      const [accs, tgs] = await Promise.all([api.accounts(), api.tags()])
      setAccounts(accs || [])
      setTags(tgs || [])
      if (baseData?.post) {
        const p = baseData.post
        setSelectedAccounts(p.account_ids || [])
        setSelectedTags(p.tag_ids || [])
        setVersions(p.versions?.length ? p.versions : [{ account_id: null, is_original: true, content: [{ type: 'text', body: '' }] }])
        setScheduledAt(p.scheduled_at ? format(new Date(p.scheduled_at), "yyyy-MM-dd'T'HH:mm") : '')
        const orig = p.versions?.find(v => v.is_original) || p.versions?.[0]
        if (orig?.content?.find(b => b.type === 'link')?.url) setShowLinkInput(true)
        if (orig?.targeting?.countries?.length || orig?.targeting?.age_min || orig?.targeting?.age_max) setShowTargeting(true)
        if (orig?.first_comment) setShowFirstComment(true)
        if (orig?.is_story) setIsStory(true)
      }
      setLoading(false)
    }
    init().catch(console.error)
  }, [postId])

  const currentVersion = () => {
    if (activeVersion === null) return versions.find(v => v.is_original) || versions[0]
    return versions.find(v => v.account_id === activeVersion) || versions.find(v => v.is_original) || versions[0]
  }

  const updateVersion = (updater) => {
    setVersions(vs => vs.map(v => {
      const isTarget = activeVersion === null ? v.is_original : v.account_id === activeVersion
      return isTarget ? updater(v) : v
    }))
  }

  const updateContent = (body) => {
    updateVersion(v => {
      const content = v.content.map(b => b.type === 'text' ? { ...b, body } : b)
      return { ...v, content: content.length ? content : [{ type: 'text', body }] }
    })
  }

  const updateLink = (url) => {
    updateVersion(v => {
      const hasLink = v.content.find(b => b.type === 'link')
      if (hasLink) return { ...v, content: v.content.map(b => b.type === 'link' ? { ...b, url } : b) }
      return { ...v, content: [...v.content, { type: 'link', url }] }
    })
  }

  const removeLink = () => {
    updateVersion(v => ({ ...v, content: v.content.filter(b => b.type !== 'link') }))
    setShowLinkInput(false)
  }

  const addMedia = (mediaItems) => {
    updateVersion(v => {
      const existing = v.content.find(b => b.type === 'media')
      if (existing) return { ...v, content: v.content.map(b => b.type === 'media' ? { ...b, media: [...(b.media || []), ...mediaItems] } : b) }
      return { ...v, content: [...v.content, { type: 'media', media: mediaItems }] }
    })
  }

  const removeMedia = (index) => {
    updateVersion(v => {
      const content = v.content.map(b => {
        if (b.type !== 'media') return b
        const media = b.media.filter((_, i) => i !== index)
        return media.length ? { ...b, media } : null
      }).filter(Boolean)
      return { ...v, content }
    })
  }

  const updateTargeting = (field, value) => {
    updateVersion(v => ({ ...v, targeting: { ...(v.targeting || {}), [field]: value } }))
  }

  const toggleCountry = (code) => {
    const current = currentVersion()?.targeting?.countries || []
    const next = current.includes(code) ? current.filter(c => c !== code) : [...current, code]
    updateTargeting('countries', next)
  }

  const toggleAccount = (id) => {
    setSelectedAccounts(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  }

  const charCount = () => {
    const text = currentVersion()?.content?.find(b => b.type === 'text')?.body || ''
    return text.length
  }

  const getLimit = () => {
    if (activeVersion && selectedAccounts.includes(activeVersion)) {
      const acc = accounts.find(a => a.id === activeVersion)
      return acc ? (PROVIDER_LIMITS[acc.provider] || 5000) : 5000
    }
    if (!selectedAccounts.length) return 5000
    const limits = selectedAccounts.map(id => {
      const acc = accounts.find(a => a.id === id)
      return acc ? (PROVIDER_LIMITS[acc.provider] || 5000) : 5000
    })
    return Math.min(...limits)
  }

  const selectedAccountObjects = selectedAccounts.map(id => accounts.find(a => a.id === id)).filter(Boolean)
  const hasFacebookAccount    = selectedAccountObjects.some(a => a.provider === 'facebook')
  const hasInstagramAccount   = selectedAccountObjects.some(a => INSTAGRAM_PROVIDERS.includes(a.provider))
  const hasCommentableAccount = selectedAccountObjects.some(a => ['facebook', 'instagram', 'instagram_login'].includes(a.provider))
  const supportsStory         = hasInstagramAccount
  const activeVersionInfo     = activeVersion ? accounts.find(a => a.id === activeVersion) : null

  const updateFirstComment = (body) => {
    updateVersion(v => ({ ...v, first_comment: body || undefined }))
  }

  // Build versions with is_story applied for Instagram
  const buildVersionsForSave = () => {
    return versions.map(v => {
      const accId = v.account_id
      if (!accId && !v.is_original) return v
      const acc = accId ? accounts.find(a => a.id === accId) : null
      const isInstagram = acc ? INSTAGRAM_PROVIDERS.includes(acc.provider) : (isStory && hasInstagramAccount && v.is_original)
      return isStory && isInstagram ? { ...v, is_story: true } : { ...v, is_story: undefined }
    })
  }

  const save = async (scheduleNow = false) => {
    if (saving) return // guard against double-submit
    const textBody = currentVersion()?.content?.find(b => b.type === 'text')?.body?.trim()
    if (!textBody) { toast.error('Post content cannot be empty'); return }
    if (scheduleNow && !selectedAccounts.length) { toast.error('Select at least one account before publishing'); return }

    setSaving(true)
    try {
      const scheduleTime = scheduledAt
        ? new Date(scheduledAt).toISOString()
        : (scheduleNow ? new Date(Date.now() + 5000).toISOString() : null)
      const payload = {
        account_ids: selectedAccounts,
        tag_ids: selectedTags,
        versions: buildVersionsForSave(),
        scheduled_at: scheduleTime,
      }
      if (isEdit) {
        await api.updatePost(postId, payload)
        if (scheduleNow) {
          try { await api.schedulePost(postId, scheduleTime) } catch (schedErr) { toast.error(schedErr.message) }
        }
        toast.success('Post updated')
      } else {
        const post = await api.createPost(payload)
        // Redirect immediately — post is saved. Schedule separately (non-fatal if it fails).
        if (scheduleNow) {
          try { await api.schedulePost(post.id, scheduleTime) } catch (schedErr) { toast.error(schedErr.message) }
        }
        toast.success(scheduledAt ? 'Post scheduled' : 'Draft saved')
        router.push('/posts')
      }
    } catch (err) {
      toast.error(err.message)
      setSaving(false)
    }
  }

  const del = async () => {
    if (!confirm('Delete this post?')) return
    try {
      await api.deletePost(postId)
      toast.success('Post deleted')
      router.push('/posts')
    } catch (err) {
      toast.error(err.message)
    }
  }

  if (loading) return <div className="skeleton" style={{ height: 400, borderRadius: 12 }} />

  const count = charCount()
  const limit = getLimit()
  const cv = currentVersion()
  const linkUrl = cv?.content?.find(b => b.type === 'link')?.url || ''
  const mediaItems = cv?.content?.find(b => b.type === 'media')?.media || []
  const targeting = cv?.targeting || {}
  const firstComment = cv?.first_comment || ''

  // Compute warnings per account
  const accountWarnings = {}
  selectedAccountObjects.forEach(acc => {
    const accLimit = PROVIDER_LIMITS[acc.provider] || 5000
    accountWarnings[acc.id] = getPlatformWarnings(acc.provider, mediaItems, count, accLimit, isStory)
  })
  const totalErrors   = Object.values(accountWarnings).flat().filter(w => w.level === 'error').length
  const totalWarnings = Object.values(accountWarnings).flat().filter(w => w.level === 'warning').length

  // Contextual placeholder
  const getPlaceholder = () => {
    if (selectedAccountObjects.some(a => a.provider === 'tiktok')) return 'Write a caption for your TikTok video...'
    if (hasInstagramAccount && !hasFacebookAccount) return 'Write a caption for Instagram...'
    if (hasFacebookAccount && !hasInstagramAccount) return "What's on your mind?"
    if (selectedAccountObjects.some(a => a.provider === 'linkedin')) return 'Share something with your LinkedIn network...'
    return "What's on your mind?"
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{isEdit ? 'Edit Post' : 'New Post'}</h1>
        <div className="flex gap-2" style={{ alignItems: 'center' }}>
          {totalErrors > 0 && (
            <span className="platform-badge platform-badge-error">{totalErrors} issue{totalErrors > 1 ? 's' : ''}</span>
          )}
          {totalErrors === 0 && totalWarnings > 0 && (
            <span className="platform-badge platform-badge-warning">{totalWarnings} warning{totalWarnings > 1 ? 's' : ''}</span>
          )}
          {isEdit && <button className="btn btn-danger btn-sm" onClick={del}>Delete</button>}
          <button className="btn btn-secondary" onClick={() => save(false)} disabled={saving}>Save Draft</button>
          <button className="btn btn-primary" onClick={() => save(true)} disabled={saving}>
            {saving ? <span className="spinner" /> : scheduledAt ? 'Schedule' : 'Publish'}
          </button>
        </div>
      </div>

      <div className="post-editor">
        {/* Editor column */}
        <div>
          {/* Version tabs */}
          {selectedAccounts.length > 0 && (
            <div className="tabs" style={{ marginBottom: '1rem' }}>
              <button className={`tab${activeVersion === null ? ' active' : ''}`} onClick={() => setActiveVersion(null)}>
                Original
              </button>
              {selectedAccountObjects.map(acc => {
                const info = PLATFORM_INFO[acc.provider]
                const warns = accountWarnings[acc.id] || []
                const hasErr = warns.some(w => w.level === 'error')
                const hasWrn = warns.some(w => w.level === 'warning')
                return (
                  <button
                    key={acc.id}
                    className={`tab${activeVersion === acc.id ? ' active' : ''}`}
                    onClick={() => setActiveVersion(acc.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <span className="provider-dot" style={{ background: info?.color || '#64748b' }} />
                    {acc.name}
                    {hasErr && <span className="tab-badge tab-badge-error">!</span>}
                    {!hasErr && hasWrn && <span className="tab-badge tab-badge-warning">!</span>}
                  </button>
                )
              })}
            </div>
          )}

          {/* Per-account warnings panel */}
          {activeVersion && accountWarnings[activeVersion]?.length > 0 && (
            <div className="platform-warnings-panel" style={{ marginBottom: '0.75rem' }}>
              {accountWarnings[activeVersion].map((w, i) => (
                <div key={i} className={`platform-warning-row platform-warning-${w.level}`}>
                  <span>{w.level === 'error' ? '✕' : '⚠'}</span>
                  <span>{w.msg}</span>
                </div>
              ))}
            </div>
          )}

          <div className="editor-area">
            <div className="editor-toolbar">
              <button className="btn btn-ghost btn-sm btn-icon" title="Add media" onClick={() => setShowMediaPicker(true)}>⬚</button>
              <button
                className={`btn btn-ghost btn-sm btn-icon${showLinkInput ? ' active' : ''}`}
                title="Add link"
                onClick={() => { setShowLinkInput(s => !s); if (!showLinkInput && !linkUrl) updateLink('') }}
              >🔗</button>
              {hasFacebookAccount && (
                <button
                  className={`btn btn-ghost btn-sm btn-icon${showTargeting ? ' active' : ''}`}
                  title="Facebook audience targeting"
                  onClick={() => setShowTargeting(s => !s)}
                >🎯</button>
              )}
              {hasCommentableAccount && (
                <button
                  className={`btn btn-ghost btn-sm${showFirstComment ? ' active' : ''}`}
                  title="Add first comment"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                  onClick={() => { setShowFirstComment(s => !s); if (showFirstComment) updateFirstComment('') }}
                >+ Comment</button>
              )}
              {supportsStory && (
                <button
                  className={`btn btn-sm${isStory ? ' btn-story-active' : ' btn-ghost'}`}
                  title="Post as Instagram Story instead of feed post"
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem', marginLeft: '0.25rem' }}
                  onClick={() => setIsStory(s => !s)}
                >
                  {isStory ? '★ Story' : '☆ Story'}
                </button>
              )}

              {/* Active platform indicator */}
              {activeVersionInfo && (
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#64748b' }}>
                  <span className="provider-dot" style={{ background: PLATFORM_INFO[activeVersionInfo.provider]?.color || '#64748b' }} />
                  {PLATFORM_INFO[activeVersionInfo.provider]?.label || activeVersionInfo.provider}
                  {isStory && INSTAGRAM_PROVIDERS.includes(activeVersionInfo.provider) && (
                    <span style={{ color: '#e1306c', fontWeight: 600 }}> · Story</span>
                  )}
                </span>
              )}
            </div>

            <div className="editor-content">
              <textarea
                className="editor-textarea"
                placeholder={getPlaceholder()}
                value={cv?.content?.find(b => b.type === 'text')?.body || ''}
                onChange={e => updateContent(e.target.value)}
                rows={6}
              />

              {showLinkInput && (
                <div className="flex gap-2" style={{ marginTop: '0.5rem', alignItems: 'center' }}>
                  <input
                    className="form-input"
                    type="url"
                    placeholder="https://example.com"
                    value={linkUrl}
                    onChange={e => updateLink(e.target.value)}
                    style={{ flex: 1, marginBottom: 0 }}
                  />
                  <button className="btn btn-ghost btn-sm" onClick={removeLink} title="Remove link">✕</button>
                </div>
              )}

              {mediaItems.length > 0 && (
                <div className="media-grid" style={{ marginTop: '0.75rem' }}>
                  {mediaItems.map((m, i) => (
                    <div key={i} className="media-item" style={{ position: 'relative' }}>
                      {m.mime_type?.startsWith('video')
                        ? <video src={m.url} style={{ width: '100%', borderRadius: 6 }} />
                        : <img src={m.url || m.thumb} alt="" />}
                      <button
                        onClick={() => removeMedia(i)}
                        style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer', fontSize: 12, lineHeight: '20px', textAlign: 'center', padding: 0 }}
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={`char-counter${count > limit ? ' over' : count > limit * 0.9 ? ' warning' : ''}`}>
              {count} / {limit}
            </div>

            {showFirstComment && hasCommentableAccount && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.75rem', marginTop: '0.25rem' }}>
                <div className="text-xs text-muted" style={{ marginBottom: '0.375rem' }}>First comment (posted immediately after the post)</div>
                <textarea
                  className="editor-textarea"
                  placeholder="Write the first comment..."
                  value={firstComment}
                  onChange={e => updateFirstComment(e.target.value)}
                  rows={3}
                />
              </div>
            )}
          </div>

          {/* Facebook Targeting panel */}
          {showTargeting && hasFacebookAccount && (
            <div className="panel" style={{ marginTop: '1rem' }}>
              <div className="panel-title">Facebook Targeting</div>
              <p className="text-xs text-muted" style={{ marginBottom: '0.75rem' }}>Limit who sees this post. Leave empty to reach all followers.</p>
              <div className="form-group">
                <label className="form-label">Countries</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  {COUNTRIES.map(([code, name]) => {
                    const selected = (targeting.countries || []).includes(code)
                    return (
                      <button
                        key={code}
                        onClick={() => toggleCountry(code)}
                        className={`tag-chip${selected ? '' : ' btn-ghost'}`}
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', background: selected ? '#6366f122' : undefined, color: selected ? '#6366f1' : undefined, border: `1px solid ${selected ? '#6366f144' : '#e5e7eb'}` }}
                      >{code} · {name}</button>
                    )
                  })}
                </div>
              </div>
              <div className="flex gap-3" style={{ marginTop: '0.75rem' }}>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Min age</label>
                  <input className="form-input" type="number" min={13} max={65} placeholder="13" value={targeting.age_min || ''} onChange={e => updateTargeting('age_min', e.target.value ? parseInt(e.target.value) : null)} />
                </div>
                <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                  <label className="form-label">Max age</label>
                  <input className="form-input" type="number" min={13} max={65} placeholder="65" value={targeting.age_max || ''} onChange={e => updateTargeting('age_max', e.target.value ? parseInt(e.target.value) : null)} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="post-sidebar">
          {/* Schedule */}
          <div className="panel">
            <div className="panel-title">Schedule</div>
            <input className="form-input" type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
          </div>

          {/* Accounts */}
          <div className="panel">
            <div className="panel-title">Accounts</div>
            {!accounts.length ? <div className="text-sm text-muted">No accounts connected</div> : (
              accounts.map(acc => {
                const info = PLATFORM_INFO[acc.provider]
                const selected = selectedAccounts.includes(acc.id)
                const warns = selected ? (accountWarnings[acc.id] || []) : []
                const hasErr = warns.some(w => w.level === 'error')
                const hasWrn = !hasErr && warns.some(w => w.level === 'warning')
                return (
                  <div key={acc.id} className={`account-option${selected ? ' selected' : ''}`} onClick={() => toggleAccount(acc.id)}>
                    <div style={{ position: 'relative', flexShrink: 0 }}>
                      {acc.media?.avatar
                        ? <img src={acc.media.avatar} className="avatar avatar-sm" alt="" />
                        : <div className="avatar avatar-sm">{acc.name[0]}</div>}
                      {info && (
                        <span className="provider-dot-sm" style={{ background: info.color, position: 'absolute', bottom: 0, right: 0, border: '2px solid #1e293b' }} />
                      )}
                    </div>
                    <div className="flex-col" style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-sm truncate">{acc.name}</div>
                      <div className="text-xs text-muted">{info?.label || acc.provider}</div>
                    </div>
                    {selected && (hasErr || hasWrn) && (
                      <span className={`platform-badge platform-badge-${hasErr ? 'error' : 'warning'}`} style={{ fontSize: '0.65rem', padding: '0.1rem 0.35rem' }}>
                        {warns.length}
                      </span>
                    )}
                    <div className={`account-check${selected ? ' selected' : ''}`} />
                  </div>
                )
              })
            )}
          </div>

          {/* Platform Guide */}
          {selectedAccountObjects.length > 0 && (
            <div className="panel">
              <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setShowGuide(s => !s)}>
                <span>Platform Guide</span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{showGuide ? '▲' : '▼'}</span>
              </div>
              {showGuide && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {selectedAccountObjects.map(acc => {
                    const info = PLATFORM_INFO[acc.provider]
                    if (!info) return null
                    return (
                      <div key={acc.id} className="platform-guide-card">
                        <div className="platform-guide-header">
                          <span className="provider-dot" style={{ background: info.color }} />
                          <span style={{ fontWeight: 600, fontSize: '0.8rem' }}>{info.label}</span>
                          <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: 'auto' }}>{acc.name}</span>
                        </div>
                        <ul className="platform-guide-list">
                          <li>Char limit: <strong>{(PROVIDER_LIMITS[acc.provider] || 5000).toLocaleString()}</strong></li>
                          {info.mediaRequired && <li className="guide-requirement">Media required</li>}
                          {info.videoOnly && <li className="guide-requirement">Video only (MP4/MOV)</li>}
                          {INSTAGRAM_PROVIDERS.includes(acc.provider) && <>
                            <li>Images: <strong>JPEG only</strong>, max 8 MB</li>
                            <li>Ratio: <strong>4:5 – 1.91:1</strong></li>
                            <li>Max: <strong>10 items</strong> (carousel)</li>
                            <li>Supports: <strong>Reels · Stories</strong></li>
                          </>}
                          {acc.provider === 'twitter' && <>
                            <li>Max: <strong>4 images</strong> or <strong>1 video</strong></li>
                            <li>No mixed image+video</li>
                          </>}
                          {acc.provider === 'linkedin' && <>
                            <li>Max: <strong>9 images</strong> or <strong>1 video</strong></li>
                          </>}
                          {acc.provider === 'facebook' && <>
                            <li>Supports: <strong>targeting · link preview</strong></li>
                          </>}
                          {info.supportsStory && (
                            <li>Use <strong>Story</strong> toggle for stories</li>
                          )}
                        </ul>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tags */}
          <div className="panel">
            <div className="panel-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Tags</span>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: '0.7rem', padding: '0.1rem 0.5rem' }}
                onClick={() => {
                  const name = prompt('Tag name:')
                  if (!name?.trim()) return
                  const hex_color = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')
                  api.createTag({ name: name.trim(), hex_color }).then(tag => {
                    setTags(ts => [...ts, tag])
                    setSelectedTags(s => [...s, tag.id])
                  }).catch(e => toast.error(e.message))
                }}
              >+ New tag</button>
            </div>
            <div className="flex" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
              {tags.map(tag => (
                <span key={tag.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
                  <button
                    className={`tag-chip${selectedTags.includes(tag.id) ? '' : ' btn-ghost'}`}
                    style={{ background: selectedTags.includes(tag.id) ? tag.hex_color + '33' : undefined, color: tag.hex_color, border: `1px solid ${tag.hex_color}44` }}
                    onClick={() => setSelectedTags(s => s.includes(tag.id) ? s.filter(x => x !== tag.id) : [...s, tag.id])}
                  >{tag.name}</button>
                  <button
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: '0.65rem', padding: '0 0.15rem', lineHeight: 1, opacity: 0.5 }}
                    title={`Delete "${tag.name}" tag`}
                    onClick={() => {
                      if (!confirm(`Delete tag "${tag.name}"?`)) return
                      api.deleteTag(tag.id).then(() => {
                        setTags(ts => ts.filter(t => t.id !== tag.id))
                        setSelectedTags(s => s.filter(id => id !== tag.id))
                      }).catch(e => toast.error(e.message))
                    }}
                  >✕</button>
                </span>
              ))}
              {tags.length === 0 && (
                <span style={{ fontSize: '0.8rem', color: 'var(--fg-muted)' }}>No tags yet — create one above</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {showMediaPicker && (
        <MediaPicker
          onSelect={(items) => { addMedia(items); setShowMediaPicker(false) }}
          onClose={() => setShowMediaPicker(false)}
        />
      )}
    </div>
  )
}
