'use client'
import { useState, useEffect, useRef, useMemo } from 'react'
import { api } from '../lib/api.js'
import { getMediaPreviewUrl } from '../lib/mediaPreview.js'
import { useToast } from './Toast.js'

const TABS = ['uploads', 'stock', 'gifs']

function itemMatchesMediaKind(item, mediaKind) {
  if (!mediaKind) return true
  const mime = String(item.mime_type || '').toLowerCase()
  if (mediaKind === 'video') return mime.startsWith('video')
  if (mediaKind === 'image') {
    if (!mime) return true
    return mime.startsWith('image')
  }
  return true
}

function visibleTabsForKind(mediaKind) {
  if (mediaKind === 'video') return ['uploads']
  return TABS
}

function MediaThumb({ item }) {
  const [src, setSrc] = useState(() => getMediaPreviewUrl(item))
  const isVideo = item.mime_type?.startsWith('video')

  const onError = () => {
    const fallback = getMediaPreviewUrl({ ...item, conversions: [] })
    if (fallback && fallback !== src) setSrc(fallback)
  }

  if (isVideo) {
    return (
      <video
        src={src}
        muted
        preload="metadata"
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        onError={onError}
      />
    )
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      onError={onError}
    />
  )
}

export default function MediaPicker({
  onSelect,
  onClose,
  multiple = true,
  mediaKind = null,
  title = null,
  confirmLabel = null,
}) {
  const tabs = useMemo(() => visibleTabsForKind(mediaKind), [mediaKind])
  const [tab, setTab] = useState(tabs[0])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(1)
  const [confirming, setConfirming] = useState(false)
  const toast = useToast()
  const fileRef = useRef()

  const load = async (t = tab, q = query, p = page) => {
    setLoading(true)
    try {
      let data
      if (t === 'uploads') data = await api.fetchUploaded(p)
      else if (t === 'stock') data = await api.fetchStock(q, p)
      else data = await api.fetchGifs(q, p)
      setItems(Array.isArray(data) ? data : data.items || [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!tabs.includes(tab)) {
      setTab(tabs[0])
      setPage(1)
      setQuery('')
      setSelected([])
    }
  }, [mediaKind, tab, tabs])

  useEffect(() => { load() }, [tab, page])

  const visibleItems = items.filter(item => itemMatchesMediaKind(item, mediaKind))

  const search = (e) => {
    e.preventDefault()
    setPage(1)
    load(tab, query, 1)
  }

  const toggle = (item) => {
    if (!itemMatchesMediaKind(item, mediaKind)) {
      toast.error(mediaKind === 'video' ? 'Select a video file' : 'Select an image file')
      return
    }
    setSelected(s => {
      const key = item.id || item.url
      const exists = s.find(x => (x.id || x.url) === key)
      if (exists) return s.filter(x => (x.id || x.url) !== key)
      return multiple ? [...s, item] : [item]
    })
  }

  const isSelected = (item) => !!selected.find(x => (x.id || x.url) === (item.id || item.url))

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files)
    for (const file of files) {
      if (mediaKind === 'video' && !file.type.startsWith('video/')) {
        toast.error('Upload a video file for this post')
        continue
      }
      if (mediaKind === 'image' && !file.type.startsWith('image/')) {
        toast.error('Upload an image file for this post')
        continue
      }
      try {
        const media = await api.uploadMedia(file)
        setItems(prev => [media, ...prev])
      } catch (err) {
        toast.error(err.message)
      }
    }
  }

  const confirm = async () => {
    const allowed = selected.filter(item => itemMatchesMediaKind(item, mediaKind))
    if (!allowed.length) {
      toast.error(mediaKind === 'video' ? 'Select a video' : 'Select an image')
      return
    }
    setConfirming(true)
    try {
      const normalized = await Promise.all(allowed.map(async item => {
        if (!item.disk) {
          const media = await api.downloadMedia(
            item.url || item.download_url,
            tab,
            item.download_location
          )
          return media
        }
        return item
      }))
      onSelect(normalized)
    } catch (err) {
      toast.error('Failed to add media: ' + err.message)
    } finally {
      setConfirming(false)
    }
  }

  const modalTitle = title
    || (mediaKind === 'video' ? 'Select video' : mediaKind === 'image' ? 'Select image' : 'Select Media')
  const selectLabel = confirmLabel || (multiple ? 'Add' : 'Select')

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
          <h2 className="modal-title" style={{ margin: 0 }}>{modalTitle}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="tabs" style={{ marginBottom: '1rem' }}>
          {tabs.map(t => (
            <button
              key={t}
              type="button"
              className={`tab${tab === t ? ' active' : ''}`}
              onClick={() => { setTab(t); setPage(1); setQuery('') }}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab !== 'uploads' && (
          <form onSubmit={search} className="flex gap-2" style={{ marginBottom: '1rem' }}>
            <input
              className="form-input"
              placeholder="Search..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" type="submit">Search</button>
          </form>
        )}

        {tab === 'uploads' && (
          <div style={{ marginBottom: '1rem' }}>
            <input
              type="file"
              ref={fileRef}
              onChange={handleUpload}
              accept={mediaKind === 'video' ? 'video/*' : mediaKind === 'image' ? 'image/*' : 'image/*,video/*'}
              multiple={mediaKind !== 'video'}
              hidden
            />
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileRef.current.click()}>
              Upload Files
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div className="media-grid">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="skeleton" style={{ aspectRatio: 1 }} />
              ))}
            </div>
          ) : !visibleItems.length ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <div className="empty-title">
                {mediaKind === 'video' ? 'No videos in your library' : mediaKind === 'image' ? 'No images found' : 'No results'}
              </div>
            </div>
          ) : (
            <div className="media-grid">
              {visibleItems.map((item, i) => (
                <div
                  key={item.id || item.url || i}
                  className={`media-item${isSelected(item) ? ' selected' : ''}`}
                  onClick={() => toggle(item)}
                >
                  <MediaThumb item={item} />
                  {isSelected(item) && <div className="media-check">✓</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={confirming}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={confirm}
            disabled={!selected.length || confirming}
          >
            {confirming ? <span className="spinner" /> : (
              multiple && selected.length > 0
                ? `${selectLabel} (${selected.length})`
                : selectLabel
            )}
          </button>
        </div>
      </div>
    </div>
  )
}