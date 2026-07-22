'use client'

import { useEffect, useState } from 'react'

/**
 * Reveal text letter-by-letter (ChatGPT-style). When animate is false, show full text.
 */
export function useTypewriter(fullText, { animate = true, cps = 48 } = {}) {
  const text = String(fullText || '')
  const [shown, setShown] = useState(() => (animate ? '' : text))
  const [done, setDone] = useState(!animate || !text)

  useEffect(() => {
    if (!animate) {
      setShown(text)
      setDone(true)
      return undefined
    }
    setShown('')
    setDone(false)
    if (!text) {
      setDone(true)
      return undefined
    }

    let i = 0
    let cancelled = false
    let timer
    const intervalMs = Math.max(8, Math.round(1000 / Math.max(12, cps)))
    const step = text.length > 280 ? 3 : text.length > 120 ? 2 : 1

    const tick = () => {
      if (cancelled) return
      i = Math.min(text.length, i + step)
      setShown(text.slice(0, i))
      if (i >= text.length) {
        setDone(true)
        return
      }
      timer = setTimeout(tick, intervalMs)
    }

    timer = setTimeout(tick, intervalMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [text, animate, cps])

  return { text: shown, done, fullText: text }
}
