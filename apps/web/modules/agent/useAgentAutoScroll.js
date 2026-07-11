'use client'

import { useCallback, useEffect, useRef } from 'react'

const NEAR_BOTTOM_PX = 120

/**
 * Auto-scroll chat to bottom only when the user is already near the bottom,
 * or when they send a new message — avoids yanking scroll during workflow updates.
 */
export function useAgentAutoScroll(deps, { enabled = true } = {}) {
  const { messages = [], workflows = {}, executionNote = null } = deps
  const containerRef = useRef(null)
  const bottomRef = useRef(null)
  const stickToBottomRef = useRef(true)
  const prevMessageCountRef = useRef(0)

  const updateStickiness = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', updateStickiness, { passive: true })
    updateStickiness()
    return () => el.removeEventListener('scroll', updateStickiness)
  }, [updateStickiness, enabled])

  useEffect(() => {
    if (!enabled) return

    const prevCount = prevMessageCountRef.current
    const grew = messages.length > prevCount
    const userSent = grew && messages[messages.length - 1]?.role === 'user'
    prevMessageCountRef.current = messages.length

    if (userSent) stickToBottomRef.current = true
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: grew ? 'smooth' : 'auto' })
    }
  }, [messages, workflows, executionNote, enabled])

  return { containerRef, bottomRef }
}
