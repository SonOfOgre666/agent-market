'use client'

import { useState } from 'react'
import MediaPicker from '../MediaPicker.js'
import { uploadAdImage, uploadAdVideo } from '../../lib/metaAdsTools.js'
import { goalRequiresVideo } from '../../lib/metaCreativeRequirements.js'

/**
 * Ad creative step — image (meta_upload_ad_image) or video (meta_upload_ad_video) by optimization goal.
 */
export default function MetaAdCreativeFields({
  accountId,
  adAccountId,
  values,
  setField,
  optimizationGoal,
  onToast,
}) {
  const [uploading, setUploading] = useState(false)
  const [showMedia, setShowMedia] = useState(false)
  const [mediaMode, setMediaMode] = useState('image')

  const needsVideo = goalRequiresVideo(optimizationGoal)

  const uploadImageFromUrl = async () => {
    const url = (values.image_url || '').trim()
    if (!accountId || !adAccountId || !url) {
      onToast?.('Select account, ad account, and image URL first', 'error')
      return
    }
    setUploading(true)
    try {
      const out = await uploadAdImage(accountId, adAccountId, { image_url: url })
      const hash = out.image_hash
      if (!hash) throw new Error('Upload succeeded but no image_hash returned')
      setField('image_hash', hash)
      onToast?.(`Image uploaded — hash ${hash.slice(0, 12)}…`)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  const uploadVideoFromUrl = async () => {
    const url = (values.video_url || '').trim()
    if (!accountId || !adAccountId || !url) {
      onToast?.('Select account, ad account, and video URL first', 'error')
      return
    }
    setUploading(true)
    try {
      const out = await uploadAdVideo(accountId, adAccountId, { video_url: url })
      const vid = out.video_id || out.id
      if (!vid) throw new Error('Upload succeeded but no video_id returned')
      setField('video_id', String(vid))
      onToast?.(`Video uploaded — id ${String(vid).slice(0, 12)}…`)
    } catch (e) {
      onToast?.(e.message, 'error')
    } finally {
      setUploading(false)
    }
  }

  const onMediaPick = async (items) => {
    const item = items?.[0]
    if (!item?.url) return
    const isVideo = item.mime_type?.startsWith('video')
    setShowMedia(false)
    if (isVideo || mediaMode === 'video') {
      setField('video_url', item.url)
      setField('image_url', '')
      setField('image_hash', '')
      if (accountId && adAccountId) {
        setUploading(true)
        try {
          const out = await uploadAdVideo(accountId, adAccountId, { video_url: item.url })
          const vid = out.video_id || out.id
          if (vid) {
            setField('video_id', String(vid))
            onToast?.('Video uploaded to Meta')
          }
        } catch (e) {
          onToast?.(e.message, 'error')
        } finally {
          setUploading(false)
        }
      }
      return
    }
    setField('image_url', item.url)
    setField('video_url', '')
    setField('video_id', '')
    if (accountId && adAccountId) {
      setUploading(true)
      try {
        const out = await uploadAdImage(accountId, adAccountId, { image_url: item.url })
        if (out.image_hash) {
          setField('image_hash', out.image_hash)
          onToast?.('Image uploaded to Meta')
        }
      } catch (e) {
        onToast?.(e.message, 'error')
      } finally {
        setUploading(false)
      }
    }
  }

  return (
    <div>
      {needsVideo ? (
        <div className="form-group">
          <label className="form-label">Ad video * (ThruPlay)</label>
          <input
            className="form-input"
            type="url"
            value={values.video_url ?? ''}
            onChange={(e) => setField('video_url', e.target.value)}
            placeholder="https://… public HTTPS MP4/MOV"
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={uploading || !values.video_url}
              onClick={uploadVideoFromUrl}
            >
              {uploading ? 'Uploading…' : 'Upload to Meta (meta_upload_ad_video)'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setMediaMode('video')
                setShowMedia(true)
              }}
            >
              Pick video from library
            </button>
          </div>
          {values.video_id && (
            <p style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: '0.35rem' }}>
              video_id ready: <code>{values.video_id}</code>
            </p>
          )}
          <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
            ThruPlay optimizes for video views. Publish uploads video_url automatically if video_id is missing.
          </p>
        </div>
      ) : (
        <div className="form-group">
          <label className="form-label">Ad image *</label>
          <input
            className="form-input"
            type="url"
            value={values.image_url ?? ''}
            onChange={(e) => setField('image_url', e.target.value)}
            placeholder="https://… (public HTTPS, or pick from library)"
          />
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={uploading || !values.image_url}
              onClick={uploadImageFromUrl}
            >
              {uploading ? 'Uploading…' : 'Upload to Meta (meta_upload_ad_image)'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setMediaMode('image')
                setShowMedia(true)
              }}
            >
              Pick from media library
            </button>
          </div>
          {values.image_hash && (
            <p style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: '0.35rem' }}>
              image_hash ready: <code>{values.image_hash}</code>
            </p>
          )}
          <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
            Required for image link ads. Publish uploads image_url automatically if hash is missing.
          </p>
        </div>
      )}

      <div className="form-group">
        <label className="form-label">Primary text</label>
        <textarea
          className="form-input"
          rows={2}
          value={values.primary_text ?? ''}
          onChange={(e) => setField('primary_text', e.target.value)}
          placeholder="Main message shown on the ad"
        />
      </div>

      {showMedia && (
        <MediaPicker
          multiple={false}
          onSelect={onMediaPick}
          onClose={() => setShowMedia(false)}
        />
      )}
    </div>
  )
}
