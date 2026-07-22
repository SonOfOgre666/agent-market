'use client'

import { useEffect, useRef, useState } from 'react'
import { Bot, X, History, MessageSquare, Trash2, Plus, Sparkles } from 'lucide-react'
import { useToast } from './Toast.js'
import { useConfirmDialog } from '../lib/useConfirmDialog.js'
import { useAgentChat } from '../modules/agent/useAgentChat.js'
import { useAgentAutoScroll } from '../modules/agent/useAgentAutoScroll.js'
import AgentChatInput from '../modules/agent/AgentChatInput.js'
import AgentMessageContent from '../modules/agent/AgentMessageContent.js'
import WorkflowCard from '../modules/agent/WorkflowCard.js'
import { shouldShowWorkflowCard, isPrimaryWorkflowMessage } from '../modules/agent/workflowUi.js'
import { getMediaPreviewUrl, getMediaSourceUrl, getMediaThumbnailUrl } from '../lib/mediaPreview.js'
import { api } from '../lib/api.js'
import { AGENT_SUGGESTIONS } from '../modules/agent/agentSuggestions.js'

const PANEL_ANIM_MS = 220
const HISTORY_ANIM_MS = 200

export default function AgentAssistant() {
  const toast = useToast()
  const { confirm, ConfirmDialogHost } = useConfirmDialog()
  const [panelMounted, setPanelMounted] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [historyMounted, setHistoryMounted] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState([])
  const [conversations, setConversations] = useState([])
  const panelTimerRef = useRef(null)
  const historyTimerRef = useRef(null)

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
    settleMessageAnimations,
    clearMessageAnimate,
  } = useAgentChat({ onToast: toast })

  const { containerRef, bottomRef } = useAgentAutoScroll(
    { messages, workflows, executionNote },
    { enabled: panelOpen },
  )

  useEffect(() => {
    if (!panelMounted) return
    api.agentConversations().then(r => setConversations(r.conversations || [])).catch(() => {})
  }, [panelMounted, conversationId])

  useEffect(() => () => {
    clearTimeout(panelTimerRef.current)
    clearTimeout(historyTimerRef.current)
  }, [])

  const openPanel = () => {
    clearTimeout(panelTimerRef.current)
    setPanelMounted(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setPanelOpen(true))
    })
  }

  const closeHistory = ({ immediate = false } = {}) => {
    clearTimeout(historyTimerRef.current)
    setHistoryOpen(false)
    if (immediate) {
      setHistoryMounted(false)
      return
    }
    historyTimerRef.current = setTimeout(() => setHistoryMounted(false), HISTORY_ANIM_MS)
  }

  const closePanel = () => {
    clearTimeout(panelTimerRef.current)
    setPanelOpen(false)
    closeHistory({ immediate: true })
    settleMessageAnimations()
    panelTimerRef.current = setTimeout(() => setPanelMounted(false), PANEL_ANIM_MS)
  }

  const togglePanel = () => {
    if (panelOpen) closePanel()
    else openPanel()
  }

  const toggleHistory = () => {
    if (historyOpen) {
      closeHistory()
      return
    }
    clearTimeout(historyTimerRef.current)
    setHistoryMounted(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setHistoryOpen(true))
    })
  }

  const handleSend = (text, media = []) => {
    const trimmed = text.trim()
    if (!trimmed && !media.length) return
    setInput('')
    setAttachments([])
    sendMessage(trimmed || 'Use the attached media for this request.', media)
  }

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
    <>
      <button
        type="button"
        className={`agent-fab${panelOpen ? ' is-open' : ''}`}
        onClick={togglePanel}
        aria-expanded={panelOpen}
        aria-label={panelOpen ? 'Close AI Agent' : 'Open AI Agent'}
      >
        {panelOpen ? <X size={22} /> : <Bot size={22} />}
      </button>

      {panelMounted && (
        <div
          className={`agent-panel${panelOpen ? ' is-open' : ''}`}
          role="dialog"
          aria-label="AI Agent"
          aria-hidden={!panelOpen}
        >
          <header className="agent-panel-header">
            <div className="agent-panel-title">
              <Bot size={18} />
              <span>AI Agent</span>
            </div>
            <p className="agent-panel-sub">
              Ask anything — I’ll plan, run tools, and reply as I go.
            </p>
            <div className="agent-panel-toolbar">
              <button
                type="button"
                className={`agent-panel-tool${historyOpen ? ' is-active' : ''}`}
                onClick={toggleHistory}
                aria-pressed={historyOpen}
                aria-label={historyOpen ? 'Hide conversation history' : 'Show conversation history'}
                title="History"
              >
                <History size={15} aria-hidden />
                <span>History</span>
              </button>
              <button
                type="button"
                className="agent-panel-tool"
                onClick={() => {
                  setAttachments([])
                  resetConversation()
                  closeHistory()
                }}
                aria-label="Start a new chat"
                title="New chat"
              >
                <Plus size={15} aria-hidden />
                <span>New</span>
              </button>
              <button
                type="button"
                className="agent-panel-tool agent-panel-tool--close"
                onClick={closePanel}
                aria-label="Close AI Agent"
                title="Close"
              >
                <X size={15} aria-hidden />
              </button>
            </div>
          </header>

          {historyMounted && (
            <aside
              className={`agent-panel-history${historyOpen ? ' is-open' : ''}`}
              aria-label="Conversation history"
              aria-hidden={!historyOpen}
            >
              <div className="agent-panel-history-inner">
                <h3 className="agent-panel-history-title">
                  <MessageSquare size={14} /> Recent
                </h3>
                <ul className="agent-conv-list">
                  {conversations.map((c, i) => (
                    <li
                      key={c.id}
                      className="agent-conv-row"
                      style={{ '--agent-stagger': `${40 + i * 35}ms` }}
                    >
                      <button
                        type="button"
                        className={`agent-conv-item${conversationId === c.id ? ' active' : ''}`}
                        onClick={() => {
                          loadConversation(c.id)
                          closeHistory()
                        }}
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
              </div>
            </aside>
          )}

          <div ref={containerRef} className="agent-messages">
            {messages.length === 0 && (
              <div className="agent-empty">
                <p className="agent-empty-lead">Your marketing co-pilot for ads, posts, and SEO.</p>
                <p className="agent-empty-hint">Try a prompt (needs a connected ads account for ads asks):</p>
                <div className="agent-suggestions" role="list">
                  {AGENT_SUGGESTIONS.map((item, i) => (
                    <button
                      key={item.id}
                      type="button"
                      role="listitem"
                      className="agent-suggestion"
                      style={{ '--agent-stagger': `${80 + i * 45}ms` }}
                      disabled={sending || Boolean(actionBusy)}
                      onClick={() => setInput(item.prompt)}
                    >
                      <Sparkles size={13} aria-hidden />
                      <span className="agent-suggestion-body">
                        <span className="agent-suggestion-label">{item.label}</span>
                        <span className="agent-suggestion-needs">Needs {item.needs}</span>
                      </span>
                    </button>
                  ))}
                </div>
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
                            <video
                              src={getMediaSourceUrl(att)}
                              poster={getMediaThumbnailUrl(att) || undefined}
                              muted
                              preload="metadata"
                            />
                          ) : (
                            <img src={getMediaPreviewUrl(att)} alt="" />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.content && (
                    <AgentMessageContent
                      content={m.content}
                      animate={m.role === 'assistant' && m.animate === true}
                      onAnimateComplete={
                        m.role === 'assistant' && m.animate === true
                          ? () => clearMessageAnimate(i)
                          : undefined
                      }
                    />
                  )}
                </div>
                {m.workflow_id
                  && isPrimaryWorkflowMessage(messages, i)
                  && workflows[m.workflow_id]
                  && shouldShowWorkflowCard(workflows[m.workflow_id]) && (
                  <WorkflowCard
                    workflow={workflows[m.workflow_id]}
                    busy={actionBusy === m.workflow_id}
                    onApprove={() => runWorkflowAction(m.workflow_id, 'approve')}
                    onExecute={() => runWorkflowAction(m.workflow_id, 'execute')}
                    onReject={() => runWorkflowAction(m.workflow_id, 'reject')}
                    onStop={stopProcessing}
                  />
                )}
              </div>
            ))}
            {sending && (
              <div className="agent-msg agent-msg--assistant">
                <div className="agent-msg-bubble agent-msg-bubble--typing">
                  <span className="agent-typing-dots" aria-hidden>
                    <i /><i /><i />
                  </span>
                  Planning…
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
            onStop={stopProcessing}
            isProcessing={isProcessing}
            sending={sending}
            placeholder="Describe what you want to accomplish…"
            rows={2}
          />
        </div>
      )}

      <ConfirmDialogHost />
    </>
  )
}
