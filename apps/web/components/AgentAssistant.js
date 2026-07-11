'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import { Bot, X, Loader2, Square } from 'lucide-react'
import { useToast } from './Toast.js'
import { useAgentChat } from '../modules/agent/useAgentChat.js'
import { useAgentAutoScroll } from '../modules/agent/useAgentAutoScroll.js'
import AgentChatInput from '../modules/agent/AgentChatInput.js'
import AgentMessageContent from '../modules/agent/AgentMessageContent.js'
import WorkflowCard from '../modules/agent/WorkflowCard.js'
import { shouldShowWorkflowCard } from '../modules/agent/workflowUi.js'
import { getMediaPreviewUrl } from '../lib/mediaPreview.js'

export default function AgentAssistant() {
  const pathname = usePathname()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState([])

  const {
    messages,
    workflows,
    sending,
    actionBusy,
    executionNote,
    isProcessing,
    sendMessage,
    stopProcessing,
    runWorkflowAction,
    resetConversation,
  } = useAgentChat({ onToast: toast })

  const { containerRef, bottomRef } = useAgentAutoScroll(
    { messages, workflows, executionNote },
    { enabled: open },
  )

  const handleSend = (text, media = []) => {
    const trimmed = text.trim()
    if (!trimmed && !media.length) return
    setInput('')
    setAttachments([])
    sendMessage(trimmed || 'Use the attached media for this request.', media)
  }

  if (pathname === '/agent') return null

  return (
    <>
      <button
        type="button"
        className="agent-fab"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close assistant' : 'Open marketing assistant'}
      >
        {open ? <X size={22} /> : <Bot size={22} />}
      </button>

      {open && (
        <div className="agent-panel" role="dialog" aria-label="Marketing assistant">
          <header className="agent-panel-header">
            <div className="agent-panel-title">
              <Bot size={18} />
              <span>Marketing Assistant</span>
            </div>
            <p className="agent-panel-sub">
              Natural language → validated workflow → you approve → runtime executes.
            </p>
            <div className="agent-panel-toolbar">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => { setAttachments([]); resetConversation() }}
              >
                New chat
              </button>
              <button type="button" className="btn btn-ghost btn-sm agent-panel-close" onClick={() => setOpen(false)}>
                <X size={16} />
              </button>
            </div>
          </header>

          {(executionNote || isProcessing) && (
            <div className="agent-exec-banner" role="status" aria-live="polite">
              <Loader2 size={14} className="spin" aria-hidden />
              <span className="agent-exec-banner-text">{executionNote || 'Working…'}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm agent-stop-btn"
                onClick={stopProcessing}
                aria-label="Stop workflow"
              >
                <Square size={12} fill="currentColor" aria-hidden />
                Stop
              </button>
            </div>
          )}

          <div ref={containerRef} className="agent-messages">
            {messages.length === 0 && (
              <div className="agent-empty">
                <p>Command interface — describe a marketing task:</p>
                <ul>
                  <li>Create a Google Search campaign called &quot;Spring SaaS&quot; with US targeting</li>
                  <li>Optimize Google geo bids for campaign id 12345678901</li>
                  <li>Suggest negative keywords for my Google Search campaign</li>
                  <li>Create remarketing audience and attach to ad group</li>
                  <li>Draft a Meta ads campaign brief for a SaaS launch</li>
                </ul>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`agent-msg agent-msg--${m.role}`}>
                <div className="agent-msg-bubble">
                  {m.attachments?.length > 0 && (
                    <div className="agent-msg-attachments">
                      {m.attachments.map(att => (
                        <div key={att.id} className="agent-msg-attach-thumb">
                          {att.mime_type?.startsWith('video/') ? (
                            <video src={getMediaPreviewUrl(att)} muted preload="metadata" />
                          ) : (
                            <img src={getMediaPreviewUrl(att)} alt="" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.content && <AgentMessageContent content={m.content} />}
                </div>
                {m.workflow_id && workflows[m.workflow_id] && shouldShowWorkflowCard(workflows[m.workflow_id]) && (
                  <WorkflowCard
                    workflow={workflows[m.workflow_id]}
                    busy={actionBusy === m.workflow_id}
                    onApprove={() => runWorkflowAction(m.workflow_id, 'approve')}
                    onExecute={() => runWorkflowAction(m.workflow_id, 'execute')}
                    onReject={() => runWorkflowAction(m.workflow_id, 'reject')}
                  />
                )}
              </div>
            ))}
            {sending && (
              <div className="agent-msg agent-msg--assistant">
                <div className="agent-msg-bubble agent-msg-bubble--typing">
                  <Loader2 size={16} className="spin" aria-hidden /> Planning workflow…
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <AgentChatInput
            value={input}
            onChange={setInput}
            attachments={attachments}
            onAttachmentsChange={setAttachments}
            onSend={handleSend}
            disabled={Boolean(actionBusy)}
            sending={sending}
            placeholder="Describe what you want to accomplish…"
            rows={2}
          />
        </div>
      )}
    </>
  )
}
