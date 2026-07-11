'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import AppLayout from '../../components/AppLayout.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { useWorkspaceSettings } from '../../components/WorkspaceSettingsProvider.js'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek, isSameMonth } from 'date-fns'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
const STATUS_COLOR = { 0: '#64748b', 1: '#60a5fa', 2: '#4ade80', 3: '#f87171' }
const STATUS_LABEL = { 0: 'Draft', 1: 'Scheduled', 2: 'Published', 3: 'Failed' }

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [dragOverDay, setDragOverDay] = useState(null)
  const draggingPost = useRef(null)
  const router = useRouter()
  const toast = useToast()
  const { weekStartsOn, calendarDayLabels, isSameDayInTimezone, formatDateTime, rescheduleIsoForCalendarDay } = useWorkspaceSettings()
  const weekStart = weekStartsOn()
  const dayHeaders = calendarDayLabels()

  const load = useCallback(async (date) => {
    setLoading(true)
    try {
      const dateStr = format(date, 'yyyy-MM')
      const data = await api.calendar(dateStr)
      setPosts(data.posts || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(currentDate) }, [currentDate, load])

  const prev = () => setCurrentDate(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n })
  const next = () => setCurrentDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n })

  // Build calendar grid
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const gridStart = startOfWeek(monthStart, { weekStartsOn: weekStart })
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: weekStart })
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  const postsForDay = (day) => posts.filter(p => p.scheduled_at && isSameDayInTimezone(p.scheduled_at, day))

  const getTitle = (post) => {
    const orig = post.versions?.find(v => v.is_original)
    const block = orig?.content?.find(b => b.type === 'text')
    return block?.body?.slice(0, 28) || 'Post'
  }

  // ── Drag & drop handlers ──────────────────────────────────────────────────

  const handleDragStart = (e, post) => {
    // Only allow dragging scheduled posts (not published/failed)
    if (post.status === 2 || post.status === 3) {
      e.preventDefault()
      return
    }
    draggingPost.current = post
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', post.id)
  }

  const handleDragOver = (e, day) => {
    if (!draggingPost.current) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDay(day.toString())
  }

  const handleDragLeave = () => {
    setDragOverDay(null)
  }

  const handleDrop = async (e, targetDay) => {
    e.preventDefault()
    setDragOverDay(null)
    const post = draggingPost.current
    draggingPost.current = null
    if (!post) return

    if (!post?.scheduled_at) return

    const newIso = rescheduleIsoForCalendarDay(post.scheduled_at, targetDay)
    if (!newIso || newIso === post.scheduled_at) return

    try {
      await api.reschedulePost(post.id, newIso)
      toast.success(`Moved to ${formatDateTime(newIso, { style: 'date-only' })}`)
      load(currentDate)
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleDragEnd = () => {
    draggingPost.current = null
    setDragOverDay(null)
  }

  return (
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Calendar size={18} strokeWidth={2.5} />
            </div>
            <div className="flex items-center gap-3">
              <button className="btn btn-ghost btn-sm" onClick={prev}>
                <ChevronLeft size={14} strokeWidth={2} />
              </button>
              <h1 className="page-title">{format(currentDate, 'MMMM yyyy')}</h1>
              <button className="btn btn-ghost btn-sm" onClick={next}>
                <ChevronRight size={14} strokeWidth={2} />
              </button>
            </div>
          </div>
          <p className="page-header-desc">Schedule and manage your posts</p>
        </div>
      </div>

      {loading && <div style={{ height: 3, background: 'var(--primary)', borderRadius: 2, marginBottom: '0.5rem', animation: 'pulse 1s infinite' }} />}

      <div className="calendar-grid">
        {dayHeaders.map(d => (
          <div key={d} className="calendar-header-cell">{d}</div>
        ))}

        {days.map(day => {
          const dayStr = day.toString()
          const isOver = dragOverDay === dayStr
          const dayPosts = postsForDay(day)

          return (
            <div
              key={dayStr}
              className={`calendar-day${isSameDayInTimezone(new Date().toISOString(), day) ? ' today' : ''}${!isSameMonth(day, currentDate) ? ' other-month' : ''}`}
              style={isOver ? { background: 'rgba(99,102,241,0.15)', outline: '2px solid #6366f1', outlineOffset: -2 } : undefined}
              onClick={() => router.push(`/posts/new?date=${format(day, 'yyyy-MM-dd')}`)}
              onDragOver={e => handleDragOver(e, day)}
              onDragLeave={handleDragLeave}
              onDrop={e => handleDrop(e, day)}
            >
              <div className="day-number">{format(day, 'd')}</div>

              {dayPosts.map(p => {
                const isDraggable = p.status !== 2 && p.status !== 3
                return (
                  <span
                    key={p.id}
                    className="calendar-post-dot"
                    style={{
                      background: STATUS_COLOR[p.status],
                      cursor: isDraggable ? 'grab' : 'pointer',
                      opacity: draggingPost.current?.id === p.id ? 0.4 : 1,
                      userSelect: 'none',
                    }}
                    draggable={isDraggable}
                    onDragStart={e => { e.stopPropagation(); handleDragStart(e, p) }}
                    onDragEnd={handleDragEnd}
                    onClick={e => { e.stopPropagation(); router.push(`/posts/${p.id}`) }}
                    title={`${STATUS_LABEL[p.status]}: ${getTitle(p)}`}
                  >
                    {getTitle(p)}
                  </span>
                )
              })}

              {isOver && (
                <div style={{ fontSize: '0.65rem', color: '#6366f1', marginTop: '0.25rem', pointerEvents: 'none' }}>
                  Drop to reschedule
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: '0.75rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {Object.entries(STATUS_LABEL).map(([status, label]) => (
          <span key={status} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[status] }} />
            {label}
          </span>
        ))}
        <span style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginLeft: 'auto' }}>
          Drag scheduled posts to reschedule
        </span>
      </div>
    </AppLayout>
  )
}
