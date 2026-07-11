'use client'

import {
  COMMENT_SYNC_UNSUPPORTED,
  COMMENT_SYNC_LIMITATIONS,
  commentSyncSupportedLabel,
  isCommentSyncSupported,
  PROVIDER_LABEL,
  uniqueProviderLabels,
} from '../lib/commentUi.js'
import { Info } from 'lucide-react'

const boxStyle = {
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid hsl(var(--border) / 0.6)',
  background: 'hsl(var(--bg-alt) / 0.45)',
  fontSize: '0.78rem',
  lineHeight: 1.45,
  color: 'hsl(var(--fg-muted))',
}

const warnStyle = {
  ...boxStyle,
  borderColor: 'hsl(var(--warning) / 0.35)',
  background: 'hsl(var(--warning) / 0.08)',
  color: 'hsl(var(--fg))',
}

/**
 * @param {{ variant?: 'compact' | 'detail', publishAccounts?: Array<{ account?: { provider?: string }, provider_post_id?: string }> }} props
 */
export default function CommentPlatformSupportNote({ variant = 'compact', publishAccounts = null }) {
  const publishedRows = (publishAccounts || []).filter((r) => r?.provider_post_id)
  const unsupportedOnPost = uniqueProviderLabels(
    publishedRows
      .map((r) => r.account?.provider)
      .filter((p) => p && !isCommentSyncSupported(p)),
  )

  if (variant === 'compact') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {unsupportedOnPost.length > 0 && (
          <div style={warnStyle}>
            <strong style={{ display: 'block', marginBottom: 4 }}>Not available for this post</strong>
            Comment sync does not support {unsupportedOnPost.join(', ')}. Comments on those networks will not appear here.
          </div>
        )}
        <p className="text-muted text-xs" style={{ margin: 0 }}>
          <Info size={12} style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
          <strong style={{ color: 'hsl(var(--fg))' }}>Supported:</strong> {commentSyncSupportedLabel()}.
          {' '}
          <strong style={{ color: 'hsl(var(--fg))' }}>Not supported:</strong> {COMMENT_SYNC_UNSUPPORTED.map((p) => p.label).join(', ')}.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {unsupportedOnPost.length > 0 && (
        <div style={warnStyle}>
          <strong style={{ display: 'block', marginBottom: 4 }}>This post includes unsupported platforms</strong>
          Published to {unsupportedOnPost.join(', ')} — comments cannot be synced for {unsupportedOnPost.length === 1 ? 'that platform' : 'those platforms'}.
        </div>
      )}

      <div style={boxStyle}>
        <div style={{ fontWeight: 600, color: 'hsl(var(--fg))', marginBottom: 6 }}>Supported for sync &amp; reply</div>
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          <li>Facebook Page</li>
          <li>Instagram (Business &amp; Direct Login)</li>
          <li>X / Twitter</li>
          <li>LinkedIn</li>
        </ul>
      </div>

      <div style={boxStyle}>
        <div style={{ fontWeight: 600, color: 'hsl(var(--fg))', marginBottom: 6 }}>Not supported</div>
        <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {COMMENT_SYNC_UNSUPPORTED.map((p) => (
            <li key={p.provider}>
              <strong>{p.label}</strong> — {p.reason}
            </li>
          ))}
        </ul>
      </div>

      {COMMENT_SYNC_LIMITATIONS.length > 0 && (
        <div style={boxStyle}>
          <div style={{ fontWeight: 600, color: 'hsl(var(--fg))', marginBottom: 6 }}>Limitations</div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {COMMENT_SYNC_LIMITATIONS.map((p) => (
              <li key={p.provider}>
                <strong>{p.label}</strong> — {p.note}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted" style={{ margin: 0 }}>
        Manual paste analysis on Overview works for any platform; only auto-sync and Reply require a supported network above.
      </p>
    </div>
  )
}

export function publishAccountProviderLabel(row) {
  return PROVIDER_LABEL[row?.account?.provider] || row?.account?.provider || 'Unknown'
}
