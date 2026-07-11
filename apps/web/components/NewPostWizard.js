'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api.js'
import { canSelectAccountForPost, filterSelectableAccountIds } from '../lib/accountKinds.js'
import { useToast } from './Toast.js'
import { useWorkspaceSettings } from './WorkspaceSettingsProvider.js'
import MediaPicker from './MediaPicker.js'
import { getMediaPreviewUrl } from '../lib/mediaPreview.js'
import {
  Image, Video, Sparkles, Loader2, ChevronLeft, ChevronRight, Eye,
  Wand2, MessageSquare, Film, Users, Clock, Save, Send, Calendar,
  CheckCircle2, Hash,
} from 'lucide-react'

const GOALS = [
  { id: 'engagement', label: 'Engagement' },
  { id: 'sales', label: 'Sales' },
  { id: 'awareness', label: 'Awareness' },
  { id: 'traffic', label: 'Traffic' },
]

const TONES = [
  { id: 'friendly', label: 'Friendly' },
  { id: 'professional', label: 'Professional' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'funny', label: 'Funny' },
]

const MAIN_STEPS = [
  { id: 'type', label: 'Type', icon: Image },
  { id: 'content', label: 'Content', icon: MessageSquare },
  { id: 'media', label: 'Media', icon: Film },
  { id: 'preview', label: 'Preview', icon: Eye },
]

function isVideoMediaItem(item) {
  if (!item || item.role === 'thumbnail') return false
  return String(item.mime_type || '').toLowerCase().startsWith('video')
}

function isCoverMediaItem(item) {
  return item?.role === 'thumbnail'
}

function isImageMediaItem(item) {
  if (!item || isCoverMediaItem(item)) return false
  const mime = String(item.mime_type || '').toLowerCase()
  return !mime || mime.startsWith('image')
}

async function uploadFromDataUrl(dataUrl, prefix, mimeHint) {
  const res = await fetch(dataUrl)
  const blob = await res.blob()
  const mime = blob.type || mimeHint || 'image/png'
  const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('webp') ? 'webp' : mime.includes('gif') ? 'gif' : mime.startsWith('video/') ? 'mp4' : 'png'
  const file = new File([blob], `${prefix}-${Date.now()}.${ext}`, { type: mime })
  return api.uploadMedia(file)
}

function StepIndicator({ steps, currentIndex }) {
  return (
    <div className="post-wizard-steps">
      {steps.map((step, i) => {
        const Icon = step.icon
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <div key={step.id} className={`post-wizard-step${active ? ' active' : ''}${done ? ' done' : ''}`}>
            <div className="post-wizard-step-dot">
              {done ? <CheckCircle2 size={16} strokeWidth={2.5} /> : <Icon size={15} strokeWidth={2.2} />}
            </div>
            <span className="post-wizard-step-label">{step.label}</span>
            {i < steps.length - 1 && <div className="post-wizard-step-line" />}
          </div>
        )
      })}
    </div>
  )
}

export default function NewPostWizard({ onClose, onDone }) {
  const toast = useToast()
  const { settings, datetimeLocalValueToIso } = useWorkspaceSettings()

  const [step, setStep] = useState(0)
  const [postType, setPostType] = useState('image')
  const [prompt, setPrompt] = useState('')
  const [goal, setGoal] = useState('engagement')
  const [tone, setTone] = useState('friendly')

  const [generatingContent, setGeneratingContent] = useState(false)
  const [postResult, setPostResult] = useState(null)
  const [selectedHashtags, setSelectedHashtags] = useState([])
  const [caption, setCaption] = useState('')

  const [mediaItems, setMediaItems] = useState([])
  const [mediaPickerTarget, setMediaPickerTarget] = useState(null)
  const [generatingMedia, setGeneratingMedia] = useState(false)
  const [mediaProgress, setMediaProgress] = useState('')

  const [pendingAction, setPendingAction] = useState(null)
  const [accounts, setAccounts] = useState([])
  const [selectedAccounts, setSelectedAccounts] = useState([])
  const [scheduledAt, setScheduledAt] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.accounts({ kind: 'social' }).then(rows => {
      setAccounts(rows || [])
      const defaults = settings?.default_accounts || []
      if (defaults.length) {
        setSelectedAccounts(filterSelectableAccountIds(defaults, rows, { videoPost: postType === 'video' }))
      }
    }).catch(() => {})
  }, [settings?.default_accounts])

  useEffect(() => {
    setSelectedAccounts(prev => filterSelectableAccountIds(prev, accounts, { videoPost: postType === 'video' }))
  }, [postType, accounts])

  const selectableAccountIds = useMemo(
    () => filterSelectableAccountIds(selectedAccounts, accounts, { videoPost: postType === 'video' }),
    [selectedAccounts, accounts, postType],
  )

  const wizardVideo = useMemo(() => mediaItems.find(isVideoMediaItem), [mediaItems])
  const wizardCover = useMemo(() => mediaItems.find(isCoverMediaItem), [mediaItems])
  const wizardImage = useMemo(() => mediaItems.find(isImageMediaItem), [mediaItems])
  const displayMediaItems = useMemo(() => {
    if (postType === 'video') {
      return [wizardVideo, wizardCover].filter(Boolean)
    }
    return wizardImage ? [wizardImage] : []
  }, [postType, wizardVideo, wizardCover, wizardImage])

  const handleLibraryMediaSelect = (items) => {
    const target = mediaPickerTarget
    if (!target) return

    const allowed = items.filter(item => {
      const mime = String(item.mime_type || '').toLowerCase()
      if (target === 'video') return mime.startsWith('video')
      return !mime || mime.startsWith('image')
    })
    if (!allowed.length) {
      toast.error(target === 'video' ? 'Select a video file' : 'Select an image file')
      return
    }

    if (target === 'video') {
      const video = allowed[0]
      setMediaItems(prev => {
        const cover = prev.find(isCoverMediaItem)
        return cover ? [video, cover] : [video]
      })
    } else if (target === 'cover') {
      const cover = { ...allowed[0], role: 'thumbnail' }
      setMediaItems(prev => {
        const video = prev.find(isVideoMediaItem)
        if (!video) {
          toast.error('Add a video first')
          return prev
        }
        return [video, cover]
      })
    } else {
      setMediaItems([allowed[0]])
    }
    setMediaPickerTarget(null)
  }

  const visibleSteps = useMemo(() => {
    const extra = []
    if (pendingAction) {
      extra.push({ id: 'accounts', label: 'Pages', icon: Users })
      if (pendingAction === 'schedule') {
        extra.push({ id: 'schedule', label: 'When', icon: Clock })
      }
    }
    return [...MAIN_STEPS, ...extra]
  }, [pendingAction])

  const stepIndexForIndicator = Math.min(step, visibleSteps.length - 1)

  const finalCaption = useMemo(() => {
    const tags = selectedHashtags.map(t => (t.startsWith('#') ? t : `#${t}`)).join(' ')
    return caption.trim() + (tags ? `\n\n${tags}` : '')
  }, [caption, selectedHashtags])

  const toggleHashtag = (tag) => {
    setSelectedHashtags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])
  }

  const toggleAccount = (id) => {
    const acc = accounts.find(a => a.id === id)
    if (!canSelectAccountForPost(acc, { videoPost: postType === 'video' })) return
    setSelectedAccounts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const generateContent = async () => {
    if (!prompt.trim()) { toast.error('Tell us what the post is about'); return }
    setGeneratingContent(true)
    try {
      const data = await api.aiGeneratePost({
        post_type: postType,
        prompt: prompt.trim(),
        goal,
        tone,
        language: 'auto',
      })
      setPostResult(data)
      setCaption(data.caption || '')
      setSelectedHashtags((data.hashtags || []).slice(0, 8))
      toast.success('Caption generated')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setGeneratingContent(false)
    }
  }

  const runAgentMediaChain = async () => {
    if (!postResult) { toast.error('Generate content first'); return }
    setGeneratingMedia(true)
    setMediaProgress('')
    try {
      const ctx = {
        caption: postResult.caption,
        hashtags: postResult.hashtags,
        hooks: postResult.hooks,
        ctas: postResult.ctas,
        post_type: postType,
        goal,
        tone,
        language: 'auto',
      }

      if (postType === 'image') {
        setMediaProgress('Writing image prompt…')
        const script = await api.aiGenerateImageScript(ctx)
        const imagePrompt = (script.image_prompt || '').trim()
        if (!imagePrompt) throw new Error('Image script did not return a prompt')
        setMediaProgress('Generating image…')
        const image = await api.aiGenerateImage({
          prompt: imagePrompt,
          purpose: 'social_post',
          style: 'marketing',
        })
        if (!image?.image) throw new Error('No image returned')
        setMediaProgress('Saving to library…')
        const uploaded = await uploadFromDataUrl(image.image, 'wizard-image', 'image/png')
        setMediaItems([uploaded])
        toast.success('Image generated')
      } else {
        setMediaProgress('Writing video script…')
        const videoScript = await api.aiGenerateVideoScript(ctx)
        setMediaProgress('Writing thumbnail prompt…')
        const imageScript = await api.aiGenerateImageScript({ ...ctx, post_type: 'video' })
        const videoPrompt = (videoScript.video_prompt || videoScript.script || '').trim()
        if (!videoPrompt) throw new Error('Video script did not return a prompt')
        setMediaProgress('Generating video & thumbnail…')
        const thumbPrompt = (imageScript.image_prompt || '').trim()
        const [video, thumb] = await Promise.all([
          api.aiGenerateVideo({ video_prompt: videoPrompt, style: 'cinematic' }),
          thumbPrompt
            ? api.aiGenerateImage({ prompt: thumbPrompt, purpose: 'social_post', style: 'marketing' })
            : Promise.resolve(null),
        ])
        if (!video?.video) throw new Error('No video returned')
        setMediaProgress('Saving to library…')
        const uploadedVideo = await uploadFromDataUrl(video.video, 'wizard-video', 'video/mp4')
        const items = [uploadedVideo]
        if (thumb?.image) {
          const uploadedThumb = await uploadFromDataUrl(thumb.image, 'wizard-thumb', 'image/png')
          items.push({ ...uploadedThumb, role: 'thumbnail' })
        }
        setMediaItems(items)
        toast.success('Video generated')
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setGeneratingMedia(false)
      setMediaProgress('')
    }
  }

  const buildVersions = () => {
    const content = [{ type: 'text', body: finalCaption }]
    if (displayMediaItems.length) {
      content.push({ type: 'media', media: displayMediaItems })
    }
    return [{ is_original: true, account_id: null, content }]
  }

  const saveDraft = async () => {
    if (!finalCaption.trim()) { toast.error('Caption is empty'); return }
    setSaving(true)
    try {
      await api.createPost({ account_ids: [], versions: buildVersions() })
      toast.success('Draft saved')
      onDone?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const finishPublishOrSchedule = async () => {
    if (!selectableAccountIds.length) { toast.error('Select at least one page'); return }
    if (pendingAction === 'schedule' && !scheduledAt) { toast.error('Pick a publication date'); return }
    setSaving(true)
    try {
      const post = await api.createPost({
        account_ids: [],
        versions: buildVersions(),
      })
      if (pendingAction === 'publish') {
        await api.publishPost(post.id, { account_ids: selectableAccountIds })
        toast.success('Post queued for publishing')
      } else {
        const iso = datetimeLocalValueToIso(scheduledAt)
        await api.schedulePost(post.id, { scheduled_at: iso, account_ids: selectableAccountIds })
        toast.success('Post scheduled')
      }
      onDone?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const canNext = () => {
    if (step === 0) return true
    if (step === 1) return Boolean(postResult && caption.trim())
    if (step === 2) {
      if (postType === 'video') return Boolean(wizardVideo)
      return Boolean(wizardImage)
    }
    return false
  }

  const goNext = () => {
    if (step === 1 && !postResult) { toast.error('Generate content before continuing'); return }
    if (step === 2 && postType === 'video' && !wizardVideo) {
      toast.error('Add or generate a video')
      return
    }
    if (step === 2 && postType === 'image' && !wizardImage) {
      toast.error('Add or generate an image')
      return
    }
    setStep(s => s + 1)
  }

  const goBack = () => {
    if (step === MAIN_STEPS.length && pendingAction) {
      setPendingAction(null)
      setStep(MAIN_STEPS.length - 1)
      return
    }
    if (step === MAIN_STEPS.length + 1 && pendingAction === 'schedule') {
      setStep(MAIN_STEPS.length)
      return
    }
    setStep(s => Math.max(0, s - 1))
  }

  const startPublish = () => {
    setPendingAction('publish')
    setStep(MAIN_STEPS.length)
  }

  const startSchedule = () => {
    setPendingAction('schedule')
    setStep(MAIN_STEPS.length)
  }

  const onAccountsContinue = () => {
    if (!selectableAccountIds.length) { toast.error('Select at least one page'); return }
    if (pendingAction === 'schedule') {
      setStep(MAIN_STEPS.length + 1)
    } else {
      finishPublishOrSchedule()
    }
  }

  return (
    <div className="post-wizard">
      <StepIndicator steps={visibleSteps} currentIndex={stepIndexForIndicator} />

      <div className="post-wizard-body">
        {step === 0 && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">What kind of post?</h2>
            <p className="post-wizard-sub">Same flow as the AI agent — image or video, then content and media.</p>
            <div className="post-wizard-type-grid">
              {[
                { id: 'image', label: 'Image post', desc: 'One image + caption', icon: Image, gradient: 'linear-gradient(135deg, hsl(262 68% 58%), hsl(221 83% 53%))' },
                { id: 'video', label: 'Video post', desc: 'One video + optional cover', icon: Video, gradient: 'linear-gradient(135deg, hsl(330 75% 55%), hsl(262 68% 58%))' },
              ].map(opt => {
                const Icon = opt.icon
                const active = postType === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    className={`post-wizard-type-card${active ? ' active' : ''}`}
                    onClick={() => { setPostType(opt.id); setMediaItems([]) }}
                  >
                    <div className="post-wizard-type-icon" style={{ background: opt.gradient }}>
                      <Icon size={26} strokeWidth={2} color="#fff" />
                    </div>
                    <div className="post-wizard-type-label">{opt.label}</div>
                    <div className="post-wizard-type-desc">{opt.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">What&apos;s on your mind?</h2>
            <p className="post-wizard-sub">We&apos;ll generate caption, hashtags, and hooks — like <code>generate_social_post</code> in the agent.</p>
            <textarea
              className="form-input post-wizard-textarea"
              rows={5}
              placeholder="e.g. Launch our summer collection — highlight breathable fabrics and free shipping…"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
            />
            <div className="post-wizard-chips-row">
              <span className="post-wizard-chip-label">Goal</span>
              {GOALS.map(g => (
                <button key={g.id} type="button" className={`post-wizard-chip${goal === g.id ? ' active' : ''}`} onClick={() => setGoal(g.id)}>{g.label}</button>
              ))}
            </div>
            <div className="post-wizard-chips-row">
              <span className="post-wizard-chip-label">Tone</span>
              {TONES.map(t => (
                <button key={t.id} type="button" className={`post-wizard-chip${tone === t.id ? ' active' : ''}`} onClick={() => setTone(t.id)}>{t.label}</button>
              ))}
            </div>
            <button type="button" className="btn btn-primary" onClick={generateContent} disabled={generatingContent || !prompt.trim()}>
              {generatingContent ? <><Loader2 size={16} className="spinner" /> Generating…</> : <><Sparkles size={16} /> Generate content</>}
            </button>
            {postResult && (
              <div className="post-wizard-generated-preview">
                <label className="form-label">Caption</label>
                <textarea className="form-input" rows={4} value={caption} onChange={e => setCaption(e.target.value)} />
                {postResult.hashtags?.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <div className="post-wizard-chip-label" style={{ marginBottom: 6 }}><Hash size={12} /> Hashtags</div>
                    <div className="post-wizard-chips-row">
                      {postResult.hashtags.map(tag => (
                        <button key={tag} type="button" className={`post-wizard-chip${selectedHashtags.includes(tag) ? ' active' : ''}`} onClick={() => toggleHashtag(tag)}>#{tag}</button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">Media</h2>
            <p className="post-wizard-sub">
              {postType === 'image'
                ? (wizardImage
                  ? 'Change the image from your library or generate a new one with AI.'
                  : 'Pick one image from your library or generate one with AI.')
                : wizardVideo
                  ? 'Change the video or add an optional cover image from your library.'
                  : 'Pick one video from your library or generate video and cover with AI.'}
            </p>
            {postType === 'video' && wizardVideo ? (
              <div className="post-wizard-cover-row" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: displayMediaItems.length ? '1rem' : 0 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setMediaPickerTarget('video')}
                >
                  <Video size={15} strokeWidth={2} />
                  Change video
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setMediaPickerTarget('cover')}
                >
                  <Image size={15} strokeWidth={2} />
                  {wizardCover ? 'Change cover image' : 'Add cover image (optional)'}
                </button>
              </div>
            ) : (
              <div className="post-wizard-media-actions">
                <button
                  type="button"
                  className="post-wizard-media-card"
                  onClick={() => setMediaPickerTarget(postType === 'video' ? 'video' : 'image')}
                >
                  {postType === 'video' ? <Video size={22} strokeWidth={2} /> : <Image size={22} strokeWidth={2} />}
                  <span>
                    {postType === 'video'
                      ? 'Add video'
                      : (wizardImage ? 'Change image' : 'Add image')}
                  </span>
                  <small>{postType === 'video' ? 'One video from library' : 'One image from library'}</small>
                </button>
                <button type="button" className="post-wizard-media-card" onClick={runAgentMediaChain} disabled={generatingMedia || !postResult}>
                  {generatingMedia ? <Loader2 size={22} className="spinner" /> : <Wand2 size={22} strokeWidth={2} />}
                  <span>{generatingMedia ? mediaProgress || 'Generating…' : 'Generate media'}</span>
                  <small>AI — same tools as agent</small>
                </button>
              </div>
            )}
            {displayMediaItems.length > 0 && (
              <div className="post-wizard-media-preview-grid">
                {displayMediaItems.map((item, i) => {
                  const src = getMediaPreviewUrl(item)
                  const isVideo = isVideoMediaItem(item)
                  const isCover = isCoverMediaItem(item)
                  return (
                    <div key={item.id || `${isCover ? 'cover' : isVideo ? 'video' : 'media'}-${i}`} className="post-wizard-media-thumb">
                      {isVideo ? (
                        <video src={src} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      {isVideo && <span className="post-wizard-media-badge">Video</span>}
                      {isCover && <span className="post-wizard-media-badge">Cover</span>}
                      <button
                        type="button"
                        className="post-wizard-media-remove"
                        onClick={() => setMediaItems(items => items.filter((row) => row !== item))}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">Preview</h2>
            <p className="post-wizard-sub">Review everything before you save, publish, or schedule.</p>
            <div className="post-wizard-preview-card">
              {postType === 'video' && wizardVideo ? (
                <div className="post-wizard-preview-media">
                  <video
                    src={getMediaPreviewUrl(wizardVideo)}
                    poster={wizardCover ? getMediaPreviewUrl(wizardCover) : undefined}
                    controls
                    style={{ width: '100%', maxHeight: 280, borderRadius: 12 }}
                  />
                </div>
              ) : wizardImage ? (
                <div className="post-wizard-preview-media">
                  <img
                    src={getMediaPreviewUrl(wizardImage)}
                    alt=""
                    style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 12 }}
                  />
                </div>
              ) : null}
              <div className="post-wizard-preview-caption">{finalCaption || '(empty)'}</div>
              <div className="post-wizard-preview-meta">
                <span className="badge badge-draft">{postType === 'video' ? 'Video' : 'Image'} post</span>
                <span className="text-muted text-sm">
                  {postType === 'video'
                    ? (wizardCover ? 'Video + cover image' : 'Video only')
                    : '1 image'}
                </span>
              </div>
            </div>
            <div className="post-wizard-action-row">
              <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={saving}>
                {saving && !pendingAction ? <span className="spinner" /> : <Save size={15} />} Save as draft
              </button>
              <button type="button" className="btn btn-primary" onClick={startPublish} disabled={saving}>
                <Send size={15} /> Publish
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={startSchedule}
                disabled={saving}
                style={{ background: 'linear-gradient(135deg, hsl(152 60% 42%), hsl(180 55% 40%))' }}
              >
                <Calendar size={15} /> Schedule
              </button>
            </div>
          </div>
        )}

        {step === MAIN_STEPS.length && pendingAction && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">Select pages</h2>
            <p className="post-wizard-sub">Choose where this post will {pendingAction === 'publish' ? 'be published' : 'be scheduled'}.</p>
            <div className="post-wizard-accounts">
              {accounts.length === 0 && <p className="text-muted text-sm">No connected social accounts. Connect one under Accounts.</p>}
              {accounts.map(acc => {
                const selectable = canSelectAccountForPost(acc, { videoPost: postType === 'video' })
                return (
                <button
                  key={acc.id}
                  type="button"
                  disabled={!selectable}
                  className={`post-wizard-account${selectedAccounts.includes(acc.id) ? ' active' : ''}`}
                  onClick={() => toggleAccount(acc.id)}
                  style={selectable ? undefined : { opacity: 0.55, cursor: 'not-allowed' }}
                >
                  <span className="post-wizard-account-name">{acc.name || acc.provider}</span>
                  <span className="text-muted text-xs">
                    {acc.provider}
                    {!selectable && acc.provider === 'tiktok' ? ' · video only' : ''}
                  </span>
                </button>
                )
              })}
            </div>
          </div>
        )}

        {step === MAIN_STEPS.length + 1 && pendingAction === 'schedule' && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">Publication date</h2>
            <p className="post-wizard-sub">When should this post go live?</p>
            <label className="form-label">Publication date</label>
            <input
              type="datetime-local"
              className="form-input"
              value={scheduledAt}
              onChange={e => setScheduledAt(e.target.value)}
              style={{ maxWidth: 280 }}
            />
          </div>
        )}
      </div>

      <div className="post-wizard-footer">
        <button type="button" className="btn btn-ghost" onClick={step === 0 ? onClose : goBack}>
          <ChevronLeft size={16} /> {step === 0 ? 'Cancel' : 'Back'}
        </button>
        <div style={{ flex: 1 }} />
        {step < 3 && (
          <button type="button" className="btn btn-primary" onClick={goNext} disabled={!canNext()}>
            Next <ChevronRight size={16} />
          </button>
        )}
        {step === MAIN_STEPS.length && pendingAction && (
          <button type="button" className="btn btn-primary" onClick={onAccountsContinue} disabled={saving}>
            {saving ? <span className="spinner" /> : pendingAction === 'schedule' ? <>Next <ChevronRight size={16} /></> : <><Send size={15} /> Publish now</>}
          </button>
        )}
        {step === MAIN_STEPS.length + 1 && pendingAction === 'schedule' && (
          <button type="button" className="btn btn-primary" onClick={finishPublishOrSchedule} disabled={saving || !scheduledAt}>
            {saving ? <span className="spinner" /> : <><Calendar size={15} /> Schedule post</>}
          </button>
        )}
      </div>

      {mediaPickerTarget && (
        <MediaPicker
          multiple={false}
          mediaKind={mediaPickerTarget === 'video' ? 'video' : 'image'}
          title={
            mediaPickerTarget === 'video'
              ? 'Select video'
              : mediaPickerTarget === 'cover'
                ? 'Select cover image'
                : 'Select image'
          }
          confirmLabel="Select"
          onClose={() => setMediaPickerTarget(null)}
          onSelect={handleLibraryMediaSelect}
        />
      )}
    </div>
  )
}
