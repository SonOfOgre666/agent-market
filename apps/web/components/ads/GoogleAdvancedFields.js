'use client'

import { GOOGLE_GEO_PRESETS } from '../../lib/googleGeoConstants.js'

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']

/** Optional advanced step: schedules, bid adjustments, audiences (post-publish tools). */
export default function GoogleAdvancedFields({ values, setField }) {
  const schedules = Array.isArray(values.ad_schedules) ? values.ad_schedules : []
  const bidAdj = values.bid_adjustments && typeof values.bid_adjustments === 'object'
    ? values.bid_adjustments
    : { device: {}, location: {} }

  const setSchedules = (next) => setField('ad_schedules', next)
  const setBidAdj = (next) => setField('bid_adjustments', next)

  const addScheduleRow = () => {
    setSchedules([
      ...schedules,
      { day_of_week: 'MONDAY', start_hour: 9, end_hour: 17, bid_modifier: 1.0 },
    ])
  }

  const updateSchedule = (idx, key, val) => {
    const copy = schedules.map((s, i) => (i === idx ? { ...s, [key]: val } : s))
    setSchedules(copy)
  }

  const removeSchedule = (idx) => setSchedules(schedules.filter((_, i) => i !== idx))

  const deviceMod = (device, val) => {
    const d = { ...(bidAdj.device || {}) }
    if (val === '' || val == null) delete d[device]
    else d[device] = parseFloat(val)
    setBidAdj({ ...bidAdj, device: d })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <p style={{ fontSize: '0.85rem', color: 'var(--fg-muted)', margin: 0 }}>
        Optional settings applied after publish via{' '}
        <code>google_create_ad_schedule</code>, <code>google_set_bid_adjustments</code>, and audience tools.
        Requires a live campaign (and ad group for audiences).
      </p>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
          <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Dayparting</h4>
          <button type="button" className="btn btn-secondary btn-sm" onClick={addScheduleRow}>
            Add window
          </button>
        </div>
        {schedules.length === 0 && (
          <p style={{ fontSize: '0.78rem', color: 'var(--fg-muted)' }}>No schedules — ads run all day.</p>
        )}
        {schedules.map((row, idx) => (
          <div
            key={idx}
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: '0.5rem',
              marginBottom: '0.5rem',
              alignItems: 'end',
            }}
          >
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Day</label>
              <select
                className="form-input"
                value={row.day_of_week || 'MONDAY'}
                onChange={(e) => updateSchedule(idx, 'day_of_week', e.target.value)}
              >
                {WEEKDAYS.map((d) => (
                  <option key={d} value={d}>{d.slice(0, 3)}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Start hr</label>
              <input
                className="form-input"
                type="number"
                min={0}
                max={23}
                value={row.start_hour ?? 0}
                onChange={(e) => updateSchedule(idx, 'start_hour', parseInt(e.target.value, 10))}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">End hr</label>
              <input
                className="form-input"
                type="number"
                min={0}
                max={24}
                value={row.end_hour ?? 23}
                onChange={(e) => updateSchedule(idx, 'end_hour', parseInt(e.target.value, 10))}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Bid mod</label>
              <input
                className="form-input"
                type="number"
                step={0.05}
                min={0.1}
                max={10}
                value={row.bid_modifier ?? 1}
                onChange={(e) => updateSchedule(idx, 'bid_modifier', parseFloat(e.target.value))}
              />
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeSchedule(idx)}>
              Remove
            </button>
          </div>
        ))}
      </section>

      <section>
        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Device bid adjustments</h4>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
          1.0 = no change; 1.2 = +20%. Maps to <code>google_set_bid_adjustments</code> device block.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
          {['mobile', 'desktop', 'tablet'].map((d) => (
            <div key={d} className="form-group" style={{ margin: 0 }}>
              <label className="form-label">{d}</label>
              <input
                className="form-input"
                type="number"
                step={0.05}
                placeholder="1.0"
                value={bidAdj.device?.[d] ?? ''}
                onChange={(e) => deviceMod(d, e.target.value)}
              />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Location bid adjustments</h4>
        <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
          Geo target constant ID → modifier. Use presets or IDs from performance reports.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBottom: '0.5rem' }}>
          {GOOGLE_GEO_PRESETS.slice(0, 6).map((p) => (
            <button
              key={p.id}
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '0.72rem' }}
              onClick={() => {
                const loc = { ...(bidAdj.location || {}), [String(p.id)]: bidAdj.location?.[p.id] ?? 1.15 }
                setBidAdj({ ...bidAdj, location: loc })
              }}
            >
              {p.label} ({p.id})
            </button>
          ))}
        </div>
        <textarea
          className="form-input"
          rows={2}
          placeholder='{"2840":1.2,"2124":0.9} — or use geo_target_constant_ids_extra'
          value={
            typeof values.bid_location_json === 'string'
              ? values.bid_location_json
              : JSON.stringify(bidAdj.location || {}, null, 0)
          }
          onChange={(e) => {
            setField('bid_location_json', e.target.value)
            try {
              const parsed = JSON.parse(e.target.value)
              if (parsed && typeof parsed === 'object') setBidAdj({ ...bidAdj, location: parsed })
            } catch {
              /* typing */
            }
          }}
        />
      </section>

      <section>
        <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem' }}>Remarketing audience</h4>
        <div className="form-group">
          <label className="form-label">Audience name (new list)</label>
          <input
            className="form-input"
            value={values.audience_name || ''}
            onChange={(e) => setField('audience_name', e.target.value)}
            placeholder="Website visitors — pricing page"
          />
        </div>
        <div className="form-group">
          <label className="form-label">URL contains (rule)</label>
          <input
            className="form-input"
            value={values.audience_url_contains || ''}
            onChange={(e) => setField('audience_url_contains', e.target.value)}
            placeholder="/pricing"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Or existing audience / user list ID</label>
          <input
            className="form-input"
            value={values.audience_id || ''}
            onChange={(e) => setField('audience_id', e.target.value)}
            placeholder="From google_list_audiences"
          />
        </div>
        <div className="form-group">
          <label className="form-label">Audience bid modifier (ad group)</label>
          <input
            className="form-input"
            type="number"
            step={0.05}
            value={values.audience_bid_modifier ?? ''}
            onChange={(e) => setField('audience_bid_modifier', e.target.value)}
            placeholder="1.15"
          />
        </div>
        <p style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>
          After publish: <code>google_create_custom_audience</code> then <code>google_add_audience_targeting</code>{' '}
          (needs ad group ID from publish).
        </p>
      </section>
    </div>
  )
}
