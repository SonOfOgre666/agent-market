import { formatDistanceToNow } from 'date-fns'

export const DEFAULT_WORKSPACE_SETTINGS = {
  timezone: 'UTC',
  date_format: 'human',
  time_format: 12,
  week_starts_on: 1,
  admin_email: '',
  default_accounts: [],
  auto_analyze_comments: false,
}

const WEEKDAY_NAMES = {
  sunday: 0,
  monday: 1,
  saturday: 6,
  0: 0,
  1: 1,
  6: 6,
}

let cachedTimezones = null

/** All IANA timezones supported by the runtime (400+). */
export function getAllTimezones() {
  if (cachedTimezones) return cachedTimezones
  try {
    cachedTimezones = Intl.supportedValuesOf('timeZone').slice().sort()
  } catch {
    cachedTimezones = COMMON_TIMEZONES.slice()
  }
  return cachedTimezones
}

/** UTC offset label, e.g. "GMT+2" or "UTC". */
export function timezoneOffsetLabel(timezone, at = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    }).formatToParts(at)
    const name = parts.find(p => p.type === 'timeZoneName')?.value
    return name || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function timezoneLabel(timezone, at = new Date()) {
  const offset = timezoneOffsetLabel(timezone, at)
  const name = timezone.replace(/_/g, ' ')
  return `${name} (${offset})`
}

/** Group timezones by region prefix for optgroups. */
export function groupTimezones(timezones = getAllTimezones()) {
  const groups = new Map()
  for (const tz of timezones) {
    const region = tz.includes('/') ? tz.split('/')[0] : 'Other'
    if (!groups.has(region)) groups.set(region, [])
    groups.get(region).push(tz)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([region, zones]) => ({ region, zones }))
}

/** Normalize API / legacy values into a consistent shape. */
export function normalizeWorkspaceSettings(raw = {}) {
  const merged = { ...DEFAULT_WORKSPACE_SETTINGS, ...raw }
  let week = merged.week_starts_on
  if (typeof week === 'string') {
    week = WEEKDAY_NAMES[week.toLowerCase()] ?? 1
  } else {
    week = Number(week)
    if (![0, 1, 6].includes(week)) week = 1
  }

  const timeFormat = Number(merged.time_format)
  const dateFormat = merged.date_format === 'full' ? 'full' : 'human'
  const tz = merged.timezone || 'UTC'
  const all = getAllTimezones()

  return {
    ...merged,
    timezone: all.includes(tz) ? tz : 'UTC',
    date_format: dateFormat,
    time_format: timeFormat === 24 ? 24 : 12,
    week_starts_on: week,
    default_accounts: Array.isArray(merged.default_accounts) ? merged.default_accounts : [],
    auto_analyze_comments: merged.auto_analyze_comments === true,
  }
}

export function weekStartsOn(settings) {
  return normalizeWorkspaceSettings(settings).week_starts_on
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function calendarDayLabels(settings) {
  const start = weekStartsOn(settings)
  return [...DAY_LABELS.slice(start), ...DAY_LABELS.slice(0, start)]
}

export function datePartsInTimezone(iso, timezone) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    const parts = Object.fromEntries(
      fmt.formatToParts(d).filter(p => p.type !== 'literal').map(p => [p.type, p.value]),
    )
    return {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    }
  } catch {
    return null
  }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dateKeyFromParts(parts) {
  if (!parts) return ''
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}`
}

export function dateKeyInTimezone(iso, timezone) {
  return dateKeyFromParts(datePartsInTimezone(iso, timezone))
}

function todayKeyInTimezone(timezone) {
  return dateKeyInTimezone(new Date().toISOString(), timezone)
}

function daysBetweenDateKeys(a, b) {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const da = Date.UTC(ay, am - 1, ad)
  const db = Date.UTC(by, bm - 1, bd)
  return Math.round((da - db) / 86400000)
}

function isTodayInTimezone(iso, timezone) {
  return dateKeyInTimezone(iso, timezone) === todayKeyInTimezone(timezone)
}

function isYesterdayInTimezone(iso, timezone) {
  return daysBetweenDateKeys(todayKeyInTimezone(timezone), dateKeyInTimezone(iso, timezone)) === 1
}

/** Compare an ISO timestamp to a local calendar Date in workspace timezone. */
export function isSameDayInTimezone(iso, day, settings) {
  const tz = normalizeWorkspaceSettings(settings).timezone
  const parts = datePartsInTimezone(iso, tz)
  if (!parts) return false
  return parts.year === day.getFullYear()
    && parts.month === day.getMonth() + 1
    && parts.day === day.getDate()
}

/** UTC ISO → value for `<input type="datetime-local">` in workspace timezone. */
export function isoToDatetimeLocalValue(iso, settings) {
  if (!iso) return ''
  const tz = normalizeWorkspaceSettings(settings).timezone
  const parts = datePartsInTimezone(iso, tz)
  if (!parts) return ''
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}`
}

/** `<input type="datetime-local">` value (workspace wall clock) → UTC ISO. */
export function datetimeLocalValueToIso(value, settings) {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/)
  if (!match) return null

  const tz = normalizeWorkspaceSettings(settings).timezone
  const target = {
    y: Number(match[1]),
    mo: Number(match[2]),
    d: Number(match[3]),
    h: Number(match[4]),
    mi: Number(match[5]),
  }

  let ts = Date.UTC(target.y, target.mo - 1, target.d, target.h, target.mi)
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })

  const targetStr = `${pad2(target.y)}-${pad2(target.mo)}-${pad2(target.d)} ${pad2(target.h)}:${pad2(target.mi)}:00`

  for (let i = 0; i < 8; i++) {
    const got = fmt.format(new Date(ts))
    if (got === targetStr) return new Date(ts).toISOString()

    const gotParts = got.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
    if (!gotParts) break

    const diffMs =
      Date.UTC(target.y, target.mo - 1, target.d, target.h, target.mi) -
      Date.UTC(+gotParts[1], +gotParts[2] - 1, +gotParts[3], +gotParts[4], +gotParts[5])
    if (diffMs === 0) return new Date(ts).toISOString()
    ts += diffMs
  }

  return new Date(ts).toISOString()
}

/** Move scheduled post to a calendar day, preserving wall-clock time in workspace TZ. */
export function rescheduleIsoForCalendarDay(oldIso, targetDay, settings) {
  const tz = normalizeWorkspaceSettings(settings).timezone
  const oldParts = datePartsInTimezone(oldIso, tz)
  if (!oldParts) return null
  const value = `${targetDay.getFullYear()}-${pad2(targetDay.getMonth() + 1)}-${pad2(targetDay.getDate())}T${pad2(oldParts.hour)}:${pad2(oldParts.minute)}`
  return datetimeLocalValueToIso(value, settings)
}

export function formatDateTime(iso, settings, options = {}) {
  if (!iso) return '—'
  const s = normalizeWorkspaceSettings(settings)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'

  const { style = 'datetime' } = options
  const tz = s.timezone

  if (s.date_format === 'human' && style !== 'time-only') {
    const dayDiff = daysBetweenDateKeys(todayKeyInTimezone(tz), dateKeyInTimezone(iso, tz))
    if (dayDiff >= 0 && dayDiff <= 7) {
      if (style === 'date-only') {
        if (isTodayInTimezone(iso, tz)) return 'Today'
        if (isYesterdayInTimezone(iso, tz)) return 'Yesterday'
      }
      if (style === 'datetime' && (isTodayInTimezone(iso, tz) || isYesterdayInTimezone(iso, tz))) {
        const time = formatAbsolute(d, s, { style: 'time-only' })
        const dayLabel = isTodayInTimezone(iso, tz) ? 'Today' : 'Yesterday'
        return `${dayLabel} at ${time}`
      }
      return formatDistanceToNow(d, { addSuffix: true })
    }
  }

  return formatAbsolute(d, s, options)
}

function formatAbsolute(date, settings, options = {}) {
  const s = normalizeWorkspaceSettings(settings)
  const { style = 'datetime' } = options
  const hour12 = s.time_format === 12

  const base = { timeZone: s.timezone }
  if (style === 'date-only') {
    return new Intl.DateTimeFormat(undefined, {
      ...base,
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date)
  }
  if (style === 'time-only') {
    return new Intl.DateTimeFormat(undefined, {
      ...base,
      hour: 'numeric',
      minute: '2-digit',
      hour12,
    }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, {
    ...base,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12,
  }).format(date)
}

/** Payload for PUT /settings — coerces UI values to API shape. */
export function settingsToApiPayload(form) {
  const weekMap = { sunday: 0, monday: 1, saturday: 6 }
  let week = form.week_starts_on
  if (typeof week === 'string') week = weekMap[week.toLowerCase()] ?? 1
  week = Number(week)
  if (![0, 1, 6].includes(week)) week = 1

  return {
    timezone: form.timezone,
    date_format: form.date_format === 'full' ? 'full' : 'human',
    time_format: Number(form.time_format) === 24 ? 24 : 12,
    week_starts_on: week,
    default_accounts: Array.isArray(form.default_accounts) ? form.default_accounts : [],
    auto_analyze_comments: form.auto_analyze_comments === true,
  }
}

/** @deprecated use getAllTimezones() */
export const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Seoul',
  'Australia/Sydney',
  'Pacific/Auckland',
]
