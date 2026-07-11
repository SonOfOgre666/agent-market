'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import {
  COMMON_TIMEZONES,
  getAllTimezones,
  timezoneLabel,
} from '../lib/workspaceSettings.js'

const MAX_RESULTS = 80

export default function TimezoneSelect({ value, onChange, id = 'timezone' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const searchRef = useRef(null)

  const all = useMemo(() => getAllTimezones(), [])

  const q = query.trim().toLowerCase()
  const options = useMemo(() => {
    if (!q) {
      const common = COMMON_TIMEZONES.filter(tz => all.includes(tz))
      if (value && !common.includes(value) && all.includes(value)) {
        return [value, ...common.filter(tz => tz !== value)]
      }
      return common
    }
    return all
      .filter(tz => tz.toLowerCase().includes(q) || timezoneLabel(tz).toLowerCase().includes(q))
      .slice(0, MAX_RESULTS)
  }, [all, q, value])

  const selectedLabel = value ? timezoneLabel(value) : 'Select timezone…'

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => searchRef.current?.focus())
    } else {
      setQuery('')
    }
  }, [open])

  const pick = (tz) => {
    onChange(tz)
    setOpen(false)
  }

  return (
    <div className="dropdown" ref={rootRef} style={{ width: '100%' }}>
      <button
        type="button"
        id={id}
        className="form-input"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown
          size={16}
          style={{
            flexShrink: 0,
            opacity: 0.7,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
          }}
        />
      </button>

      {open && (
        <div
          className="dropdown-menu"
          role="listbox"
          aria-label="Timezones"
          style={{
            left: 0,
            right: 0,
            minWidth: '100%',
            maxWidth: '100%',
            padding: 0,
            overflow: 'hidden',
          }}
        >
          <div style={{ padding: '0.5rem 0.5rem 0.35rem', borderBottom: '1px solid hsl(var(--border))' }}>
            <div className="search-input-wrap" style={{ position: 'relative' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'hsl(var(--fg-muted))',
                  pointerEvents: 'none',
                }}
              />
              <input
                ref={searchRef}
                type="search"
                className="form-input"
                placeholder="Search all timezones…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                style={{ paddingLeft: '2.25rem', fontSize: '0.8125rem' }}
                aria-label="Search timezones"
              />
            </div>
            {!q && (
              <p className="text-xs text-muted" style={{ margin: '0.35rem 0 0 0.25rem' }}>
                Popular zones shown — search for all {all.length} IANA timezones.
              </p>
            )}
            {q && options.length === MAX_RESULTS && (
              <p className="text-xs text-muted" style={{ margin: '0.35rem 0 0 0.25rem' }}>
                Showing first {MAX_RESULTS} matches — refine your search.
              </p>
            )}
          </div>

          <div style={{ maxHeight: 260, overflowY: 'auto', padding: '0.3rem' }}>
            {options.length === 0 ? (
              <p className="text-sm text-muted" style={{ padding: '0.75rem' }}>No timezones match.</p>
            ) : (
              options.map(tz => (
                <button
                  key={tz}
                  type="button"
                  role="option"
                  aria-selected={tz === value}
                  className="dropdown-item"
                  onClick={() => pick(tz)}
                  style={{
                    fontWeight: tz === value ? 600 : 400,
                    color: tz === value ? 'hsl(var(--primary))' : undefined,
                  }}
                >
                  {timezoneLabel(tz)}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {!open && (
        <p className="text-xs text-muted" style={{ marginTop: 6 }}>
          {all.length} IANA timezones available
        </p>
      )}
    </div>
  )
}
