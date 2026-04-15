'use client'
import { useEffect, createContext } from 'react'
import { subscribe } from '../lib/socket.js'
import { useToast } from './Toast.js'

const RealtimeContext = createContext(null)

export function RealtimeProvider({ children }) {
  const toast = useToast()

  useEffect(() => {
    const unsubs = []

    unsubs.push(subscribe('agentmarket:post_published', (data) => {
      if (data.errors?.length) {
        toast.error(`Post published with ${data.errors.length} error(s)`)
      } else {
        toast.success('Post published successfully')
      }
    }))

    unsubs.push(subscribe('agentmarket:post_scheduled', () => {
      toast.info('Post scheduled')
    }))

    // Mirrors AccountUnauthorized event + SendAccountUnauthorizedNotification listener
    unsubs.push(subscribe('agentmarket:account_unauthorized', () => {
      toast.error(`Account disconnected — please reconnect it in Accounts settings.`)
    }))

    return () => unsubs.forEach(fn => typeof fn === 'function' && fn())
  }, [])

  return <RealtimeContext.Provider value={{}}>{children}</RealtimeContext.Provider>
}
