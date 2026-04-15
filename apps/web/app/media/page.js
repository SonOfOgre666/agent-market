'use client'
import { useEffect, useState, useRef } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'

export default function MediaPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(1)
  const toast = useToast()
  const fileRef = useRef()

  const load = () => {
    setLoading(true)
    api.media({ page, per_page: 30 }).then(setData).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const deleteSelected = async () => {
    if (!selected.length || !confirm(`Delete ${selected.length} media item(s)?`)) return
    try {
      await api.deleteMedia(selected)
      setSelected([])
      load()
      toast.success('Media deleted')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const upload = async (e) => {
    const files = Array.from(e.target.files)
    for (const file of files) {
      try {
        await api.uploadMedia(file)
        toast.success(`${file.name} uploaded`)
      } catch (err) {
        toast.error(err.message)
      }
    }
    load()
  }

  return (
    <AppLayout>
      <div className="page-header">
        <h1 className="page-title">Media Library</h1>
        <div className="flex gap-2">
          {selected.length > 0 && <button className="btn btn-danger btn-sm" onClick={deleteSelected}>Delete ({selected.length})</button>}
          <input type="file" ref={fileRef} onChange={upload} accept="image/*,video/*" multiple hidden />
          <button className="btn btn-primary" onClick={() => fileRef.current.click()}>Upload</button>
        </div>
      </div>

      {loading ? (
        <div className="media-grid">{[1,2,3,4,5,6].map(i => <div key={i} className="skeleton" style={{ aspectRatio: 1 }} />)}</div>
      ) : !data?.items?.length ? (
        <div className="empty-state">
          <div className="empty-icon">⬚</div>
          <div className="empty-title">No media yet</div>
          <button className="btn btn-primary" onClick={() => fileRef.current.click()}>Upload Files</button>
        </div>
      ) : (
        <>
          <div className="media-grid">
            {data.items.map(item => (
              <div key={item.id} className={`media-item${selected.includes(item.id) ? ' selected' : ''}`} onClick={() => toggle(item.id)}>
                {item.mime_type?.startsWith('video')
                  ? <video src={item.url} muted />
                  : <img src={item.conversions?.find(c => c.name === 'thumbnail')?.url || item.url} alt={item.name} loading="lazy" />}
                {selected.includes(item.id) && <div className="media-check">✓</div>}
              </div>
            ))}
          </div>

          {data.last_page > 1 && (
            <div className="pagination">
              <button className="page-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
              {Array.from({ length: data.last_page }, (_, i) => i + 1).map(p => (
                <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ))}
              <button className="page-btn" disabled={page === data.last_page} onClick={() => setPage(p => p + 1)}>›</button>
            </div>
          )}
        </>
      )}
    </AppLayout>
  )
}
