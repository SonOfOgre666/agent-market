'use client'

import { useState } from 'react'

/**
 * Extensions step — maps to google_create_sitelink_extensions & google_create_callout_extensions.
 * Stored on wizard values until post-publish (or Tool Console).
 */
export default function GoogleExtensionsFields({ values, setField }) {
  const [sitelinkError, setSitelinkError] = useState(null)

  const parseSitelinks = (raw) => {
    const trimmed = (raw || '').trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed)
        setSitelinkError(null)
        return Array.isArray(arr) ? arr : []
      } catch (e) {
        setSitelinkError(e.message)
        return []
      }
    }
    return trimmed.split('\n').map((line) => {
      const [text, url] = line.split('|').map((s) => s.trim())
      return text && url ? { text, url, description1: text, description2: 'Learn more' } : null
    }).filter(Boolean)
  }

  const sitelinksPreview = parseSitelinks(values.sitelinks_raw)

  return (
    <>
      <div className="form-group">
        <label className="form-label">Sitelinks</label>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.5rem' }}>
          <code>google_create_sitelink_extensions</code> — one per line: <strong>Label | https://url</strong> or JSON array.
        </p>
        <textarea
          className="form-input"
          rows={4}
          value={values.sitelinks_raw ?? ''}
          onChange={(e) => {
            setField('sitelinks_raw', e.target.value)
            setField('sitelinks', parseSitelinks(e.target.value))
          }}
          placeholder={'Pricing | https://example.com/pricing\nAbout | https://example.com/about'}
        />
        {sitelinkError && <p style={{ color: 'var(--danger)', fontSize: '0.75rem' }}>{sitelinkError}</p>}
        {sitelinksPreview.length > 0 && (
          <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
            {sitelinksPreview.length} sitelink(s) ready
          </p>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Callouts</label>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.5rem' }}>
          <code>google_create_callout_extensions</code> — one callout per line (max ~25 chars each).
        </p>
        <textarea
          className="form-input"
          rows={3}
          value={values.callouts_raw ?? ''}
          onChange={(e) => {
            setField('callouts_raw', e.target.value)
            setField('callouts', e.target.value.split('\n').map((l) => l.trim()).filter(Boolean))
          }}
          placeholder={'Free shipping\n24/7 support\n30-day returns'}
        />
      </div>
    </>
  )
}
