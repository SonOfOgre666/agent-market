'use client'

import { Loader2 } from 'lucide-react'
import Modal from './Modal.js'

/**
 * In-app confirmation dialog (replaces window.confirm).
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = 'Confirm',
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  busy = false,
}) {
  const handleConfirm = () => {
    if (busy) return
    onConfirm?.()
  }

  return (
    <Modal open={open} onClose={busy ? undefined : onClose}>
      <div
        className="modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="modal-title" style={{ marginBottom: '0.5rem' }}>
          {title}
        </h2>
        {message != null && message !== '' && (
          <div
            id="confirm-dialog-desc"
            className={`confirm-dialog-message text-muted${typeof message === 'string' && message.includes('\n') ? ' confirm-dialog-message--pre' : ''}`}
          >
            {message}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={variant === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? <Loader2 size={16} className="spin" aria-hidden /> : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}
