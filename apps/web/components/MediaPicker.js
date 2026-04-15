'use client'
import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api.js'
import { useToast } from './Toast.js'

const TABS = ['uploads', 'stock', 'gifs']

export default function MediaPicker({ onSelect, onClose, multiple = true }) {
  const [tab, setTab] = useState('uploads')
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

  useEffect(() => { load() }, [tab, page])

  const search = (e) => {
    e.preventDefault()
    setPage(1)
    load(tab, query, 1)
  }

  const toggle = (item) => {
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
      try {
        const media = await api.uploadMedia(file)
        setItems(prev => [media, ...prev])
      } catch (err) {
        toast.error(err.message)
      }
    }
  }

  const confirm = async () => {
    setConfirming(true)
    try {
      const normalized = await Promise.all(selected.map(async item => {
        // Download any item that isn't already in our library (no disk = external)
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

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 720, maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
          <h2 className="modal-title" style={{ margin: 0 }}>Select Media</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="tabs" style={{ marginBottom: '1rem' }}>
          {TABS.map(t => <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => { setTab(t); setPage(1); setQuery('') }}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
        </div>

        {tab !== 'uploads' && (
          <form onSubmit={search} className="flex gap-2" style={{ marginBottom: '1rem' }}>
            <input className="form-input" placeholder="Search..." value={query} onChange={e => setQuery(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-primary" type="submit">Search</button>
          </form>
        )}

        {tab === 'uploads' && (
          <div style={{ marginBottom: '1rem' }}>
            <input type="file" ref={fileRef} onChange={handleUpload} accept="image/*,video/*" multiple hidden />
            <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current.click()}>Upload Files</button>
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div className="media-grid">{[1,2,3,4,5,6].map(i => <div key={i} className="skeleton" style={{ aspectRatio: 1 }} />)}</div>
          ) : !items.length ? (
            <div className="empty-state" style={{ padding: '2rem' }}><div className="empty-title">No results</div></div>
          ) : (
            <div className="media-grid">
              {items.map((item, i) => (
                <div key={item.id || item.url || i} className={`media-item${isSelected(item) ? ' selected' : ''}`} onClick={() => toggle(item)}>
                  {item.mime_type?.startsWith('video')
                    ? <video src={item.url} muted preload="metadata" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <img src={item.thumb || item.preview || item.url} alt={item.name || ''} loading="lazy" />}
                  {isSelected(item) && <div className="media-check">✓</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={confirming}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm} disabled={!selected.length || confirming}>
            {confirming ? <span className="spinner" /> : `Add${selected.length > 0 ? ` (${selected.length})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
