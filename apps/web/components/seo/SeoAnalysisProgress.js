'use client'

import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

export default function SeoAnalysisProgress({ steps, activeIndex = 0 }) {
  return (
    <div className="seo-progress">
      {steps.map((label, i) => {
        const done = i < activeIndex
        const active = i === activeIndex
        return (
          <div key={label} className={`seo-progress-step${done ? ' done' : ''}${active ? ' active' : ''}`}>
            <span className="seo-progress-icon">
              {done ? <Check size={12} strokeWidth={3} /> : active ? <Loader2 size={12} className="spin" /> : null}
            </span>
            <span>{label}</span>
          </div>
        )
      })}
    </div>
  )
}

export function useAnalysisProgress(steps, running) {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    if (!running) {
      setActiveIndex(0)
      return undefined
    }
    setActiveIndex(0)
    const timers = steps.map((_, i) =>
      setTimeout(() => setActiveIndex(i + 1), (i + 1) * 1200),
    )
    return () => timers.forEach(clearTimeout)
  }, [running, steps])

  return Math.min(activeIndex, steps.length)
}
