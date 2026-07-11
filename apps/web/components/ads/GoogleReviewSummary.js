'use client'

import { buildGoogleReviewSections } from '../../lib/googleAdsWorkflow.js'

/** Review step: show values grouped by Google Ads tool_id. */
export default function GoogleReviewSummary({ values }) {
  const sections = buildGoogleReviewSections(values)

  return (
    <div style={{ fontSize: '0.875rem' }}>
      {sections.map((section) => (
        <div key={section.tool} style={{ marginBottom: '1rem' }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: '0.8rem',
              marginBottom: '0.35rem',
              fontFamily: 'var(--font-mono, monospace)',
            }}
          >
            {section.tool}
          </div>
          <ul style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--fg-muted)' }}>
            {section.rows.map((row) => (
              <li key={`${section.tool}-${row.key}`}>
                <code style={{ fontSize: '0.75rem' }}>{row.label}</code>: {row.value}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
