'use client'

import { Fragment, useEffect } from 'react'
import { useTypewriter } from './useTypewriter.js'

function renderInline(text) {
  if (!text) return null
  const parts = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let match
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index))
    }
    parts.push(<strong key={`${match.index}-${match[1]}`}>{match[1]}</strong>)
    last = match.index + match[0].length
  }
  if (last < text.length) {
    parts.push(text.slice(last))
  }
  return parts.length ? parts : text
}

function renderLine(line, index) {
  const trimmed = line.trim()
  if (!trimmed) {
    return <br key={`br-${index}`} />
  }

  if (trimmed.startsWith('• ')) {
    return (
      <p key={index} className="agent-msg-list-item">
        <span className="agent-msg-bullet" aria-hidden>•</span>
        {renderInline(trimmed.slice(2))}
      </p>
    )
  }

  const ordered = trimmed.match(/^(\d+)\.\s+(.*)$/)
  if (ordered) {
    return (
      <p key={index} className="agent-msg-list-item agent-msg-list-item--ordered">
        <span className="agent-msg-list-num">{ordered[1]}.</span>
        {renderInline(ordered[2])}
      </p>
    )
  }

  return (
    <p key={index} className="agent-msg-line">
      {renderInline(line)}
    </p>
  )
}

/** Renders assistant/user chat text with **bold**, bullets, and line breaks. */
export default function AgentMessageContent({ content, animate = false, onAnimateComplete }) {
  const { text, done } = useTypewriter(content ?? '', { animate: Boolean(content) && animate })

  useEffect(() => {
    if (animate && done && content) onAnimateComplete?.()
  }, [animate, done, content, onAnimateComplete])

  if (content == null || content === '') return null

  const lines = String(text).split('\n')
  return (
    <div className={`agent-msg-content${animate && !done ? ' is-typing' : ''}`}>
      {lines.map((line, i) => (
        <Fragment key={i}>{renderLine(line, i)}</Fragment>
      ))}
      {animate && !done && <span className="agent-msg-caret" aria-hidden />}
    </div>
  )
}
