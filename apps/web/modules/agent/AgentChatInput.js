'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, Send, Square, X, Image as ImageIcon, Upload } from 'lucide-react'
import MediaPicker from '../../components/MediaPicker.js'
import { api } from '../../lib/api.js'
import { getMediaPreviewUrl, getMediaSourceUrl, getMediaThumbnailUrl } from '../../lib/mediaPreview.js'
import { useToast } from '../../components/Toast.js'
import { toAgentAttachment } from './agentAttachments.js'

function AttachmentPreview({ item, onRemove }) {
  const isVideo = item.mime_type?.startsWith('video/')
  const src = isVideo ? getMediaSourceUrl(item) : getMediaPreviewUrl(item)
  const poster = isVideo ? getMediaThumbnailUrl(item) : ''

  return (
    <div className="agent-attach-preview">
      <div className="agent-attach-thumb">
        {isVideo ? (
          <video src={src} poster={poster || undefined} muted preload="metadata" />
        ) : (
          <img src={src} alt="" />
        )}
      </div>
      <div className="agent-attach-meta">
        <span className="agent-attach-name">{item.name || 'Attachment'}</span>
        <span className="agent-attach-type">{isVideo ? 'Video' : 'Image'}</span>
      </div>
      <button
        type="button"
        className="agent-attach-remove"
        onClick={onRemove}
        aria-label="Remove attachment"
      >
        <X size={14} />
      </button>
    </div>
  )
}

export default function AgentChatInput({
  value,
  onChange,
  onSend,
  onStop,
  disabled = false,
  sending = false,
  isProcessing = false,
  placeholder = 'Describe what you want to accomplish…',
  rows = 2,
  className = '',
  attachments = [],
  onAttachmentsChange,
}) {
  const toast = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const menuRef = useRef(null)
  const uploadRef = useRef(null)
  const textareaRef = useRef(null)

  const busy = Boolean(sending || isProcessing)

  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [menuOpen])

  const setAttachments = (next) => {
    onAttachmentsChange?.(next)
  }

  const addAttachment = (item) => {
    const att = toAgentAttachment(item)
    if (!att) {
      toast.error('Only images and videos can be attached')
      return
    }
    setAttachments([att])
    setMenuOpen(false)
    setPickerOpen(false)
    textareaRef.current?.focus()
  }

  const handleUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    setMenuOpen(false)
    for (const file of files) {
      try {
        const media = await api.uploadMedia(file)
        addAttachment(media)
        toast.success(`${file.name} attached`)
        break
      } catch (err) {
        toast.error(err.message || 'Upload failed')
      }
    }
  }

  const handleSend = () => {
    if (busy) return
    const text = value.trim()
    if (!text && !attachments.length) return
    onSend(text, attachments)
  }

  const canSend = Boolean(value.trim() || attachments.length)

  return (
    <>
      <footer className={`agent-input-wrap ${className}`.trim()}>
        {attachments.length > 0 && (
          <div className="agent-attach-row">
            {attachments.map(att => (
              <AttachmentPreview
                key={att.id}
                item={att}
                onRemove={() => setAttachments([])}
              />
            ))}
          </div>
        )}

        <div className="agent-input-row">
          <div className="agent-attach-anchor" ref={menuRef}>
            <button
              type="button"
              className="btn btn-ghost agent-attach-btn"
              onClick={() => setMenuOpen(o => !o)}
              disabled={disabled || busy}
              aria-label="Attach media"
              aria-expanded={menuOpen}
            >
              <Plus size={18} />
            </button>
            {menuOpen && (
              <div className="agent-attach-menu" role="menu">
                <button
                  type="button"
                  className="agent-attach-menu-item"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); setPickerOpen(true) }}
                >
                  <ImageIcon size={16} />
                  Choose from Media Library
                </button>
                <button
                  type="button"
                  className="agent-attach-menu-item"
                  role="menuitem"
                  onClick={() => uploadRef.current?.click()}
                >
                  <Upload size={16} />
                  Upload New Media
                </button>
              </div>
            )}
            <input
              ref={uploadRef}
              type="file"
              accept="image/*,video/*"
              hidden
              onChange={handleUpload}
            />
          </div>

          <textarea
            ref={textareaRef}
            className="form-input agent-input"
            rows={rows}
            placeholder={busy ? 'Working…' : placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (busy) {
                  onStop?.()
                  return
                }
                if (canSend && !disabled) handleSend()
              }
            }}
            disabled={disabled || busy}
          />

          <button
            type="button"
            className="btn btn-primary agent-send"
            disabled={busy ? false : (disabled || !canSend)}
            onClick={busy ? () => onStop?.() : handleSend}
            aria-label={busy ? 'Stop' : 'Send message'}
            title={busy ? 'Stop' : 'Send'}
          >
            {busy ? <Square size={16} fill="currentColor" aria-hidden /> : <Send size={18} />}
          </button>
        </div>
      </footer>

      {pickerOpen && (
        <MediaPicker
          multiple={false}
          onClose={() => setPickerOpen(false)}
          onSelect={(items) => {
            const item = Array.isArray(items) ? items[0] : items
            if (item) addAttachment(item)
          }}
        />
      )}
    </>
  )
}
