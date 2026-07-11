'use client'

import { useEffect, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import { useToast } from '../../components/Toast.js'
import { useConfirmDialog } from '../../lib/useConfirmDialog.js'
import { useAgentChat } from '../../modules/agent/useAgentChat.js'
import { useAgentAutoScroll } from '../../modules/agent/useAgentAutoScroll.js'
import WorkflowCard from '../../modules/agent/WorkflowCard.js'
import { shouldShowWorkflowCard } from '../../modules/agent/workflowUi.js'
import { api } from '../../lib/api.js'
import { Bot, Loader2, MessageSquare, Trash2, Square } from 'lucide-react'
import AgentChatInput from '../../modules/agent/AgentChatInput.js'
import AgentMessageContent from '../../modules/agent/AgentMessageContent.js'
import { getMediaPreviewUrl } from '../../lib/mediaPreview.js'

export default function AgentPage() {
  const toast = useToast()
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState([])
  const [conversations, setConversations] = useState([])
  const { confirm, ConfirmDialogHost } = useConfirmDialog()

  const {
    messages,
    conversationId,
    workflows,
    sending,
    actionBusy,
    executionNote,
    isProcessing,
    sendMessage,
    stopProcessing,
    runWorkflowAction,
    loadConversation,
    resetConversation,
  } = useAgentChat({ onToast: toast })

  const { containerRef, bottomRef } = useAgentAutoScroll({
    messages,
    workflows,
    executionNote,
  })

  useEffect(() => {
    api.agentConversations().then(r => setConversations(r.conversations || [])).catch(() => {})
  }, [conversationId])

  const requestDeleteConversation = (c) => {
    confirm({
      title: 'Delete conversation?',
      message: `“${c.title || 'Conversation'}” will be removed permanently, including any linked workflows.`,
      confirmLabel: 'Delete',
      onConfirm: async () => {
        try {
          await api.agentDeleteConversation(c.id)
          setConversations(prev => prev.filter(x => x.id !== c.id))
          if (conversationId === c.id) {
            setAttachments([])
            resetConversation()
          }
          toast.success('Conversation deleted')
        } catch (err) {
          toast.error(err.message || 'Failed to delete conversation')
          throw err
        }
      },
    })
  }

  return (
    <AppLayout>
      <div className="agent-page">
        <header className="page-header-enhanced">
          <div className="page-header-content">
            <div className="page-header-title">
              <Bot size={22} />
              <h1>AI Agent</h1>
            </div>
            <p className="text-muted" style={{ margin: 0, fontSize: '0.875rem' }}>
              Conversational control plane — plans validated workflows; runtime executes after approval.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => { setAttachments([]); resetConversation() }}
          >
            New conversation
          </button>
        </header>

        <div className="agent-page-grid">
          <aside className="agent-page-sidebar card">
            <h3 className="card-title" style={{ fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              <MessageSquare size={14} /> Recent
            </h3>
            <ul className="agent-conv-list">
              {conversations.map(c => (
                <li key={c.id} className="agent-conv-row">
                  <button
                    type="button"
                    className={`agent-conv-item${conversationId === c.id ? ' active' : ''}`}
                    onClick={() => loadConversation(c.id)}
                  >
                    {c.title || 'Conversation'}
                  </button>
                  <button
                    type="button"
                    className="agent-conv-delete"
                    aria-label={`Delete ${c.title || 'conversation'}`}
                    onClick={() => requestDeleteConversation(c)}
                  >
                    <Trash2 size={14} strokeWidth={2} />
                  </button>
                </li>
              ))}
              {!conversations.length && (
                <li className="text-muted" style={{ fontSize: '0.8rem' }}>No conversations yet</li>
              )}
            </ul>
          </aside>

          <section className="agent-page-main card">
            {(executionNote || isProcessing) && (
              <div className="agent-exec-banner" role="status">
                <Loader2 size={14} className="spin" />
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
            <div ref={containerRef} className="agent-messages agent-messages--page">
              {messages.length === 0 && (
                <div className="agent-empty">
                  <p>Describe a marketing operation in natural language. Examples:</p>
                  <ul style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
                    <li>Create a Google Search campaign &quot;Q2 Launch&quot; with US geo</li>
                    <li>How are my Google Ads performing? (account summary + hints)</li>
                    <li>Optimize geo bids for Google campaign id …</li>
                    <li>Add dayparting schedule weekdays 9–17</li>
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
                    <Loader2 size={16} className="spin" /> Planning…
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <AgentChatInput
              className="agent-input-row--page"
              value={input}
              onChange={setInput}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              onSend={(text, media) => {
                const trimmed = text.trim()
                if (!trimmed && !media.length) return
                setInput('')
                setAttachments([])
                sendMessage(trimmed || 'Use the attached media for this request.', media)
              }}
              disabled={false}
              sending={sending}
              placeholder="e.g. Create a Facebook post promoting this product…"
              rows={3}
            />
          </section>
        </div>
      </div>

      <ConfirmDialogHost />
    </AppLayout>
  )
}
