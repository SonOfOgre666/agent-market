'use client'

import { useCallback, useState } from 'react'
import {
  buildGeoTargeting,
  estimateAudienceSize,
  parseCountries,
  searchAdsArchive,
  searchGeoLocations,
  searchInterests,
} from '../../lib/metaAdsTools.js'

/** Targeting step — geo, interests, audience estimate, Ads Library (all via /ads/tools/execute). */
export default function MetaTargetingFields({
  accountId,
  adAccountId,
  values,
  setField,
  optimizationGoal,
}) {
  const [geoQuery, setGeoQuery] = useState('')
  const [geoHits, setGeoHits] = useState([])
  const [geoLoading, setGeoLoading] = useState(false)
  const [interestQuery, setInterestQuery] = useState('')
  const [interestHits, setInterestHits] = useState([])
  const [interestLoading, setInterestLoading] = useState(false)
  const [audienceEstimate, setAudienceEstimate] = useState(null)
  const [estimateLoading, setEstimateLoading] = useState(false)
  const [estimateError, setEstimateError] = useState(null)
  const [libraryQuery, setLibraryQuery] = useState('')
  const [libraryHits, setLibraryHits] = useState([])
  const [libraryLoading, setLibraryLoading] = useState(false)
  const [libraryError, setLibraryError] = useState(null)

  const selectedInterests = Array.isArray(values.meta_interests) ? values.meta_interests : []

  const runGeoSearch = useCallback(async () => {
    if (!accountId || !geoQuery.trim()) return
    setGeoLoading(true)
    try {
      const rows = await searchGeoLocations(accountId, geoQuery.trim())
      setGeoHits(Array.isArray(rows) ? rows : [])
    } catch {
      setGeoHits([])
    } finally {
      setGeoLoading(false)
    }
  }, [accountId, geoQuery])

  const runInterestSearch = useCallback(async () => {
    if (!accountId || !interestQuery.trim()) return
    setInterestLoading(true)
    try {
      const rows = await searchInterests(accountId, interestQuery.trim())
      setInterestHits(Array.isArray(rows) ? rows : [])
    } catch {
      setInterestHits([])
    } finally {
      setInterestLoading(false)
    }
  }, [accountId, interestQuery])

  const runAdsLibrarySearch = useCallback(async () => {
    if (!accountId || !libraryQuery.trim()) return
    const codes = parseCountries(values.target_countries || 'US')
    if (!codes.length) {
      setLibraryError('Set target countries (ISO codes) above first — Ads Library requires ad_reached_countries.')
      setLibraryHits([])
      return
    }
    setLibraryLoading(true)
    setLibraryError(null)
    try {
      const { data } = await searchAdsArchive(accountId, libraryQuery.trim(), codes, { ad_type: 'ALL' })
      setLibraryHits(Array.isArray(data) ? data : [])
    } catch (e) {
      setLibraryError(e.message || 'Ads Library search failed')
      setLibraryHits([])
    } finally {
      setLibraryLoading(false)
    }
  }, [accountId, libraryQuery, values.target_countries])

  const addInterest = (row) => {
    const id = row.id || row.key
    if (!id) return
    if (selectedInterests.some((x) => String(x.id) === String(id))) return
    setField('meta_interests', [
      ...selectedInterests,
      { id: String(id), name: row.name || row.label || String(id) },
    ])
  }

  const removeInterest = (id) => {
    setField(
      'meta_interests',
      selectedInterests.filter((x) => String(x.id) !== String(id)),
    )
  }

  const addGeoCountry = (row) => {
    const code = row.country_code || row.key || row.code
    if (!code) return
    const existing = parseCountries(values.target_countries || 'US')
    if (existing.includes(String(code).toUpperCase())) return
    setField('target_countries', [...existing, String(code).toUpperCase()].join(', '))
  }

  const runEstimate = async () => {
    if (!accountId || !adAccountId) return
    setEstimateLoading(true)
    setEstimateError(null)
    setAudienceEstimate(null)
    try {
      const flexible =
        selectedInterests.length > 0
          ? [{ interests: selectedInterests.map((i) => ({ id: i.id, name: i.name })) }]
          : null
      const targeting = buildGeoTargeting(values.target_countries, flexible)
      const out = await estimateAudienceSize(accountId, {
        adAccountId,
        targeting,
        optimizationGoal: optimizationGoal || 'REACH',
      })
      setAudienceEstimate(out.estimate || out.data || out)
    } catch (e) {
      setEstimateError(e.message)
    } finally {
      setEstimateLoading(false)
    }
  }

  const chipStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    padding: '0.2rem 0.5rem',
    borderRadius: 6,
    background: 'var(--surface-2)',
    fontSize: '0.75rem',
    marginRight: '0.35rem',
    marginBottom: '0.35rem',
  }

  return (
    <div>
      <div className="form-group">
        <label className="form-label">Target countries (ISO codes)</label>
        <input
          className="form-input"
          value={values.target_countries ?? 'US'}
          onChange={(e) => setField('target_countries', e.target.value)}
          placeholder="US, CA, GB"
        />
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
          Used by meta_create_adset via meta_publish_campaign.
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">Search locations (meta_search_geo_locations)</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            className="form-input"
            value={geoQuery}
            onChange={(e) => setGeoQuery(e.target.value)}
            placeholder="e.g. United States"
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), runGeoSearch())}
          />
          <button type="button" className="btn btn-secondary" onClick={runGeoSearch} disabled={geoLoading || !accountId}>
            {geoLoading ? '…' : 'Search'}
          </button>
        </div>
        {geoHits.length > 0 && (
          <ul style={{ fontSize: '0.8rem', marginTop: '0.5rem', paddingLeft: '1rem' }}>
            {geoHits.slice(0, 8).map((row, i) => (
              <li key={row.key || row.country_code || i} style={{ marginBottom: '0.25rem' }}>
                {row.name || row.key}{' '}
                <button type="button" className="btn btn-secondary" style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem' }} onClick={() => addGeoCountry(row)}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Interests (meta_search_interests)</label>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            className="form-input"
            value={interestQuery}
            onChange={(e) => setInterestQuery(e.target.value)}
            placeholder="e.g. Fitness"
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), runInterestSearch())}
          />
          <button type="button" className="btn btn-secondary" onClick={runInterestSearch} disabled={interestLoading || !accountId}>
            {interestLoading ? '…' : 'Search'}
          </button>
        </div>
        {selectedInterests.length > 0 && (
          <div style={{ marginTop: '0.5rem' }}>
            {selectedInterests.map((i) => (
              <span key={i.id} style={chipStyle}>
                {i.name}
                <button type="button" onClick={() => removeInterest(i.id)} style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}>×</button>
              </span>
            ))}
          </div>
        )}
        {interestHits.length > 0 && (
          <ul style={{ fontSize: '0.8rem', marginTop: '0.5rem', paddingLeft: '1rem' }}>
            {interestHits.slice(0, 8).map((row, i) => (
              <li key={row.id || i} style={{ marginBottom: '0.25rem' }}>
                {row.name}{' '}
                <button type="button" className="btn btn-secondary" style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem' }} onClick={() => addInterest(row)}>
                  Add
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="form-group">
        <label className="form-label">Ads Library — competitor ads (meta_search_ads_library)</label>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.35rem' }}>
          Uses your <strong>target countries</strong> as <code>ad_reached_countries</code>. Requires a token with Ads Library access; disable with{' '}
          <code>META_ADS_DISABLE_ADS_LIBRARY</code> on the worker.
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            className="form-input"
            value={libraryQuery}
            onChange={(e) => setLibraryQuery(e.target.value)}
            placeholder="e.g. brand or product keywords"
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), runAdsLibrarySearch())}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={runAdsLibrarySearch}
            disabled={libraryLoading || !accountId}
          >
            {libraryLoading ? '…' : 'Search'}
          </button>
        </div>
        {libraryError && (
          <p style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.35rem' }}>{libraryError}</p>
        )}
        {libraryHits.length > 0 && (
          <ul style={{ fontSize: '0.8rem', marginTop: '0.5rem', paddingLeft: '1rem', maxHeight: 220, overflow: 'auto' }}>
            {libraryHits.slice(0, 10).map((row, i) => (
              <li key={row.id || row.page_id || i} style={{ marginBottom: '0.5rem' }}>
                <strong>{row.page_name || 'Page'}</strong>
                {row.ad_creative_body && (
                  <span style={{ display: 'block', color: 'var(--fg-muted)', marginTop: '0.15rem' }}>
                    {(row.ad_creative_body || '').slice(0, 120)}
                    {(row.ad_creative_body || '').length > 120 ? '…' : ''}
                  </span>
                )}
                {row.ad_snapshot_url && (
                  <a href={row.ad_snapshot_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.75rem' }}>
                    Open snapshot
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="form-group">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={runEstimate}
          disabled={estimateLoading || !accountId || !adAccountId}
        >
          {estimateLoading ? 'Estimating…' : 'Estimate audience (meta_estimate_audience_size)'}
        </button>
        {estimateError && (
          <p style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.35rem' }}>{estimateError}</p>
        )}
        {audienceEstimate && (
          <p style={{ fontSize: '0.8rem', marginTop: '0.35rem', color: 'var(--fg-muted)' }}>
            Users: {audienceEstimate.users_lower_bound ?? audienceEstimate.estimated_audience_size ?? JSON.stringify(audienceEstimate)}
            {audienceEstimate.users_upper_bound != null ? ` – ${audienceEstimate.users_upper_bound}` : ''}
          </p>
        )}
      </div>
    </div>
  )
}
