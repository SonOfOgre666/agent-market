'use client'

import { normalizeGoogleFormValues } from '../../lib/googleAdsWorkflow.js'
import { googleRsaDraft, validateGoogleRsaForPublish } from '../../lib/googleRsaValidation.js'

/** Shows RSA publish readiness on the Review step. */
export default function GoogleRsaPublishChecklist({ values }) {
  const v = normalizeGoogleFormValues(values)
  const { headlines, descriptions, linkUrl } = googleRsaDraft(v)
  const { ok, errors } = validateGoogleRsaForPublish(v)

  return (
    <div
      style={{
        marginBottom: '1rem',
        padding: '0.75rem 1rem',
        borderRadius: 8,
        border: `1px solid ${ok ? 'var(--success, #10b981)' : 'var(--warning, #f59e0b)'}`,
        background: ok ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)',
        fontSize: '0.8rem',
      }}
    >
      <strong>{ok ? 'Ready to publish to Google' : 'Not ready to publish yet'}</strong>
      <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
        <li>
          final_url: {linkUrl ? '✓' : '✗ missing'}
        </li>
        <li>
          Headlines: {headlines.length}/3 minimum {headlines.length >= 3 ? '✓' : '✗'}
          {headlines.length > 0 && (
            <span style={{ color: 'var(--fg-muted)' }}> — enter one headline per line</span>
          )}
        </li>
        <li>
          Descriptions: {descriptions.length}/2 minimum {descriptions.length >= 2 ? '✓' : '✗'}
        </li>
      </ul>
      {!ok && errors.length > 0 && (
        <p style={{ margin: '0.5rem 0 0', color: 'var(--fg-muted)' }}>
          {errors[0]}
          {errors.length > 1 ? ` (+${errors.length - 1} more)` : ''}. Use <strong>Back</strong> to edit the Ads step.
        </p>
      )}
    </div>
  )
}
