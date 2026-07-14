'use client'
import { useEffect, useState, useRef } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { getMediaPreviewUrl, getMediaSourceUrl, getMediaThumbnailUrl } from '../../lib/mediaPreview.js'
import { useToast } from '../../components/Toast.js'
import { useConfirmDialog } from '../../lib/useConfirmDialog.js'
import { Image, Upload, Trash2, Check } from 'lucide-react'

export default function MediaPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(1)
  const toast = useToast()
  const { confirm, ConfirmDialogHost } = useConfirmDialog()
  const fileRef = useRef()

  const load = () => {
    setLoading(true)
    api.media({ page, per_page: 30 }).then(setData).catch(e => toast.error(e.message)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [page])

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const deleteSelected = async () => {
    if (!selected.length) return
    const ok = await confirm({
      title: 'Delete media?',
      message: `Delete ${selected.length} media item(s)? Files will be removed from storage.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
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
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Image size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">Media Library</h1>
          </div>
          <p className="page-header-desc">Manage your images and videos</p>
        </div>
        <div className="flex gap-2">
          {selected.length > 0 && <button className="btn btn-danger btn-sm" onClick={deleteSelected}>
            <Trash2 size={12} strokeWidth={2} /> Delete ({selected.length})
          </button>}
          <input type="file" ref={fileRef} onChange={upload} accept="image/*,video/*" multiple hidden />
          <button className="btn btn-primary" onClick={() => fileRef.current.click()}>
            <Upload size={14} strokeWidth={2} /> Upload
          </button>
        </div>
      </div>

      {loading ? (
        <div className="media-grid">{[1,2,3,4,5,6].map(i => <div key={i} className="skeleton" style={{ aspectRatio: 1 }} />)}</div>
      ) : !data?.items?.length ? (
        <div className="empty-state-enhanced">
          <div className="empty-state-icon">
            <Image size={32} strokeWidth={1.5} />
          </div>
          <div className="empty-state-title">No media yet</div>
          <button className="btn btn-primary" onClick={() => fileRef.current.click()}>
            <Upload size={14} strokeWidth={2} /> Upload Files
          </button>
        </div>
      ) : (
        <>
          <div className="media-grid">
            {data.items.map(item => (
              <div key={item.id} className={`media-item${selected.includes(item.id) ? ' selected' : ''}`} onClick={() => toggle(item.id)}>
                {item.mime_type?.startsWith('video')
                  ? (
                    <video
                      src={getMediaSourceUrl(item)}
                      poster={getMediaThumbnailUrl(item) || undefined}
                      muted
                      autoPlay
                      loop
                      playsInline
                      preload="metadata"
                    />
                  )
                  : <img src={getMediaPreviewUrl(item)} alt="" loading="lazy" />}
                {selected.includes(item.id) && (
                  <div className="media-check">
                    <Check size={12} strokeWidth={3} />
                  </div>
                )}
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
      <ConfirmDialogHost />
    </AppLayout>
  )
}
