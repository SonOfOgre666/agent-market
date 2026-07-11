'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { useAuth } from './AuthProvider.js'
import {
  DEFAULT_WORKSPACE_SETTINGS,
  normalizeWorkspaceSettings,
  formatDateTime,
  weekStartsOn,
  calendarDayLabels,
  isSameDayInTimezone,
  isoToDatetimeLocalValue,
  datetimeLocalValueToIso,
  rescheduleIsoForCalendarDay,
} from '../lib/workspaceSettings.js'

const WorkspaceSettingsContext = createContext(null)

export function WorkspaceSettingsProvider({ children }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState(DEFAULT_WORKSPACE_SETTINGS)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    if (!user) {
      setSettings(DEFAULT_WORKSPACE_SETTINGS)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const data = await api.settings()
      setSettings(normalizeWorkspaceSettings(data))
    } catch {
      setSettings(DEFAULT_WORKSPACE_SETTINGS)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    refresh()
  }, [refresh, user?.workspace?.id])

  const value = useMemo(() => ({
    settings,
    loading,
    refresh,
    formatDateTime: (iso, options) => formatDateTime(iso, settings, options),
    weekStartsOn: () => weekStartsOn(settings),
    calendarDayLabels: () => calendarDayLabels(settings),
    isSameDayInTimezone: (iso, day) => isSameDayInTimezone(iso, day, settings),
    isoToDatetimeLocalValue: (iso) => isoToDatetimeLocalValue(iso, settings),
    datetimeLocalValueToIso: (value) => datetimeLocalValueToIso(value, settings),
    rescheduleIsoForCalendarDay: (oldIso, targetDay) => rescheduleIsoForCalendarDay(oldIso, targetDay, settings),
  }), [settings, loading, refresh])

  return (
    <WorkspaceSettingsContext.Provider value={value}>
      {children}
    </WorkspaceSettingsContext.Provider>
  )
}

export function useWorkspaceSettings() {
  const ctx = useContext(WorkspaceSettingsContext)
  if (!ctx) {
    throw new Error('useWorkspaceSettings must be used within WorkspaceSettingsProvider')
  }
  return ctx
}
