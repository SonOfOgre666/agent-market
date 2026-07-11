'use client'

import { useState, useCallback, useRef } from 'react'
import ConfirmDialog from '../components/ConfirmDialog.js'

/**
 * Promise-based in-app confirmations (replaces window.confirm).
 *
 * @example
 * const { confirm, ConfirmDialogHost } = useConfirmDialog()
 * const ok = await confirm({ title: 'Delete?', message: '…', confirmLabel: 'Delete' })
 * if (!ok) return
 */
export function useConfirmDialog() {
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const resolveRef = useRef(null)

  const close = useCallback((result) => {
    if (busy) return
    resolveRef.current?.(result)
    resolveRef.current = null
    setState(null)
  }, [busy])

  const confirm = useCallback((opts) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({
        title: opts.title ?? 'Confirm',
        message: opts.message ?? '',
        confirmLabel: opts.confirmLabel ?? 'Confirm',
        cancelLabel: opts.cancelLabel ?? 'Cancel',
        variant: opts.variant ?? 'danger',
        onConfirm: opts.onConfirm,
      })
    })
  }, [])

  const handleConfirm = useCallback(async () => {
    if (!state || busy) return
    if (typeof state.onConfirm === 'function') {
      setBusy(true)
      try {
        await state.onConfirm()
        close(true)
      } catch {
        /* caller shows toast; keep dialog open */
      } finally {
        setBusy(false)
      }
    } else {
      close(true)
    }
  }, [state, busy, close])

  function ConfirmDialogHost() {
    return (
      <ConfirmDialog
        open={Boolean(state)}
        onClose={() => close(false)}
        onConfirm={handleConfirm}
        title={state?.title}
        message={state?.message}
        confirmLabel={state?.confirmLabel}
        cancelLabel={state?.cancelLabel}
        variant={state?.variant}
        busy={busy}
      />
    )
  }

  return { confirm, ConfirmDialogHost }
}
