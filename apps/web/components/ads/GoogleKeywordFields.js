'use client'

import { parseGoogleKeywordEntries } from '../../lib/googleKeywordParse.js'

/** Keywords with per-line match type (reference create_keywords). */
export default function GoogleKeywordFields({ values, setField }) {
  const preview = parseGoogleKeywordEntries(
    values.keywords,
    values.keyword_match_type || 'BROAD',
  )

  return (
    <>
      <div className="form-group">
        <label className="form-label">keyword_entries default match_type</label>
        <select
          className="form-input"
          value={values.keyword_match_type ?? 'BROAD'}
          onChange={(e) => setField('keyword_match_type', e.target.value)}
        >
          <option value="BROAD">Broad</option>
          <option value="PHRASE">Phrase</option>
          <option value="EXACT">Exact</option>
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">keyword_entries (one per line)</label>
        <textarea
          className="form-input"
          rows={5}
          value={values.keywords ?? ''}
          onChange={(e) => setField('keywords', e.target.value)}
          placeholder={'buy shoes\nrunning gear | PHRASE\n[EXACT] premium brand'}
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
          One per line. Optional per-keyword match: suffix <code>| PHRASE</code> or prefix{' '}
          <code>[EXACT]</code>. Stored as <code>targeting.keyword_entries</code> for{' '}
          <code>google_add_keywords</code>.
        </p>
        {preview.length > 0 && (
          <ul style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginTop: '0.5rem', paddingLeft: '1.1rem' }}>
            {preview.slice(0, 8).map((k, i) => (
              <li key={`${k.text}-${i}`}>
                <strong>{k.text}</strong> · {k.match_type}
              </li>
            ))}
            {preview.length > 8 && <li>…and {preview.length - 8} more</li>}
          </ul>
        )}
      </div>
    </>
  )
}
