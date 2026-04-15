'use client'
import { useState, useRef, useCallback } from 'react'

const COLORS = ['#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e']

function formatLabel(val) {
  if (val >= 1_000_000) return (val / 1_000_000).toFixed(1) + 'M'
  if (val >= 1_000) return (val / 1_000).toFixed(1) + 'K'
  return String(val)
}

function formatDate(dateStr) {
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' })
  } catch {
    return dateStr
  }
}

/**
 * LineChart — pure SVG line/area chart
 *
 * Props:
 *  - data: Array<{ date: string, [key]: number }>
 *  - series: Array<{ key: string, label: string, color?: string }>
 *  - height?: number
 *  - title?: string
 */
export default function LineChart({ data = [], series = [], height = 220, title }) {
  const [tooltip, setTooltip] = useState(null) // { x, y, point }
  const svgRef = useRef(null)

  const W = 800
  const H = height
  const PAD = { top: 16, right: 24, bottom: 36, left: 56 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  if (!data.length || !series.length) {
    return (
      <div className="card">
        {title && <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>{title}</div>}
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-muted)', fontSize: '0.875rem' }}>
          No data available for this period
        </div>
      </div>
    )
  }

  // Compute min/max across all series
  const allValues = data.flatMap(d => series.map(s => d[s.key] ?? 0))
  const rawMax = Math.max(...allValues)
  const rawMin = 0
  // Nice round top
  const maxVal = rawMax === 0 ? 10 : Math.ceil(rawMax * 1.1 / (10 ** Math.floor(Math.log10(rawMax || 1)))) * (10 ** Math.floor(Math.log10(rawMax || 1)))

  const xScale = (i) => PAD.left + (i / Math.max(data.length - 1, 1)) * innerW
  const yScale = (v) => PAD.top + innerH - (v / maxVal) * innerH

  // Tick marks for Y axis
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(maxVal * f))

  // X ticks — show up to 7
  const xTickStep = Math.ceil(data.length / 7)
  const xTicks = data.map((_, i) => i).filter(i => i % xTickStep === 0 || i === data.length - 1)

  const handleMouseMove = useCallback((e) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const relX = svgX - PAD.left
    if (relX < 0 || relX > innerW) { setTooltip(null); return }
    const idx = Math.round((relX / innerW) * (data.length - 1))
    const clamped = Math.max(0, Math.min(data.length - 1, idx))
    setTooltip({ idx: clamped, svgX: xScale(clamped), svgY: PAD.top + innerH / 2, point: data[clamped] })
  }, [data, innerW])

  const handleMouseLeave = useCallback(() => setTooltip(null), [])

  return (
    <div className="card">
      {title && <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>{title}</div>}

      {/* Legend */}
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: '1.25rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          {series.map((s, i) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
              <span style={{ width: 12, height: 3, borderRadius: 2, background: s.color || COLORS[i % COLORS.length], display: 'inline-block' }} />
              {s.label}
            </div>
          ))}
        </div>
      )}

      <div style={{ position: 'relative', width: '100%' }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          style={{ width: '100%', height: 'auto', display: 'block', overflow: 'visible' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            {series.map((s, i) => {
              const color = s.color || COLORS[i % COLORS.length]
              return (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={color} stopOpacity="0" />
                </linearGradient>
              )
            })}
          </defs>

          {/* Grid lines */}
          {yTicks.map(tick => (
            <line
              key={tick}
              x1={PAD.left} y1={yScale(tick)}
              x2={PAD.left + innerW} y2={yScale(tick)}
              stroke="rgba(255,255,255,0.06)" strokeWidth="1"
            />
          ))}

          {/* Y axis labels */}
          {yTicks.map(tick => (
            <text
              key={tick}
              x={PAD.left - 8} y={yScale(tick)}
              textAnchor="end" dominantBaseline="middle"
              style={{ fontSize: 11, fill: 'var(--fg-muted)' }}
            >
              {formatLabel(tick)}
            </text>
          ))}

          {/* X axis labels */}
          {xTicks.map(i => (
            <text
              key={i}
              x={xScale(i)} y={PAD.top + innerH + 20}
              textAnchor="middle"
              style={{ fontSize: 10, fill: 'var(--fg-muted)' }}
            >
              {formatDate(data[i]?.date)}
            </text>
          ))}

          {/* Area fills */}
          {series.map((s, si) => {
            const color = s.color || COLORS[si % COLORS.length]
            const pts = data.map((d, i) => [xScale(i), yScale(d[s.key] ?? 0)])
            const areaPath = [
              `M ${pts[0][0]} ${PAD.top + innerH}`,
              ...pts.map(([x, y]) => `L ${x} ${y}`),
              `L ${pts[pts.length - 1][0]} ${PAD.top + innerH}`,
              'Z',
            ].join(' ')
            return <path key={s.key} d={areaPath} fill={`url(#grad-${s.key})`} />
          })}

          {/* Lines */}
          {series.map((s, si) => {
            const color = s.color || COLORS[si % COLORS.length]
            const d = data.map((row, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(row[s.key] ?? 0)}`).join(' ')
            return <path key={s.key} d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          })}

          {/* Hover vertical line */}
          {tooltip && (
            <line
              x1={tooltip.svgX} y1={PAD.top}
              x2={tooltip.svgX} y2={PAD.top + innerH}
              stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4 3"
            />
          )}

          {/* Hover dots */}
          {tooltip && series.map((s, si) => {
            const color = s.color || COLORS[si % COLORS.length]
            const val = tooltip.point[s.key] ?? 0
            return (
              <circle
                key={s.key}
                cx={tooltip.svgX}
                cy={yScale(val)}
                r="4"
                fill={color}
                stroke="var(--surface-1)"
                strokeWidth="2"
              />
            )
          })}
        </svg>

        {/* Tooltip box */}
        {tooltip && (
          <div style={{
            position: 'absolute',
            left: `calc(${(tooltip.svgX / W) * 100}% + 10px)`,
            top: '12px',
            transform: tooltip.svgX / W > 0.7 ? 'translateX(-110%)' : undefined,
            background: 'var(--surface-2)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 8,
            padding: '0.5rem 0.75rem',
            pointerEvents: 'none',
            fontSize: '0.75rem',
            minWidth: 120,
            zIndex: 10,
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}>
            <div style={{ color: 'var(--fg-muted)', marginBottom: '0.35rem', fontWeight: 500 }}>
              {formatDate(tooltip.point.date)}
            </div>
            {series.map((s, si) => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.2rem' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color || COLORS[si % COLORS.length], flexShrink: 0 }} />
                <span style={{ color: 'var(--fg-muted)' }}>{s.label}:</span>
                <span style={{ fontWeight: 600 }}>{(tooltip.point[s.key] ?? 0).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
