'use client'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders overlay + children into document.body so position:fixed is not clipped
 * by ancestors with transform (e.g. .layout-content-shell fade-in animation).
 */
export default function Modal({ open, onClose, children }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      {children}
    </div>,
    document.body
  )
}
