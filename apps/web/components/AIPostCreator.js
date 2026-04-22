'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '../lib/api.js'
import { useToast } from './Toast.js'

const PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: '📸' },
  { id: 'linkedin', label: 'LinkedIn', icon: '💼' },
  { id: 'twitter', label: 'Twitter / X', icon: '𝕏' },
  { id: 'facebook', label: 'Facebook', icon: '🔵' },
  { id: 'tiktok', label: 'TikTok', icon: '🎵' },
]

const POST_TYPES = [
  { id: 'image', label: 'Image Post', icon: '📸' },
  { id: 'video', label: 'Video Post', icon: '🎥' },
  { id: 'thread', label: 'Thread', icon: '🧵' },
  { id: 'ad', label: 'Ad Post', icon: '📢' },
]

const GOALS = [
  { id: 'engagement', label: 'Engagement', icon: '🔥' },
  { id: 'sales', label: 'Sales', icon: '💰' },
  { id: 'awareness', label: 'Awareness', icon: '📣' },
  { id: 'traffic', label: 'Traffic', icon: '🚀' },
]

const TONES = [
  { id: 'professional', label: 'Professional' },
  { id: 'friendly', label: 'Friendly' },
  { id: 'funny', label: 'Funny' },
  { id: 'marketing', label: 'Marketing' },
]

const IMAGE_STYLES = [
  { id: 'realistic', label: 'Realistic' },
  { id: 'minimal', label: 'Minimal' },
  { id: 'product', label: 'Product' },
  { id: 'marketing', label: 'Marketing' },
]

const CHAR_LIMITS = {
  instagram: 2200,
  linkedin: 3000,
  twitter: 280,
  facebook: 63206,
  tiktok: 2200,
}

export default function AIPostCreator() {
  const router = useRouter()
  const toast = useToast()

  const [platform, setPlatform] = useState('instagram')
  const [postType, setPostType] = useState('image')
  const [prompt, setPrompt] = useState('')
  const [goal, setGoal] = useState('engagement')
  const [tone, setTone] = useState('friendly')

  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)

  const [caption, setCaption] = useState('')
  const [selectedHashtags, setSelectedHashtags] = useState([])

  const [imagePrompt, setImagePrompt] = useState('')
  const [imageStyle, setImageStyle] = useState('realistic')
  const [generatingImage, setGeneratingImage] = useState(false)
  const [generatedImage, setGeneratedImage] = useState(null)

  const [previewTab, setPreviewTab] = useState('instagram')

  const [accounts, setAccounts] = useState([])
  const [selectedAccounts, setSelectedAccounts] = useState([])
  const [saving, setSaving] = useState(false)

  const captionRef = useRef(null)

  useEffect(() => {
    api.accounts().then(a => setAccounts(a || [])).catch(() => {})
  }, [])

  useEffect(() => {
    setPreviewTab(platform)
  }, [platform])

  const generate = async () => {
    if (!prompt.trim()) { toast.error('Please describe what you want to create'); return }
    setGenerating(true)
    setResult(null)
    try {
      const data = await api.aiGeneratePost({ platform, post_type: postType, prompt, goal, tone })
      setResult(data)
      setCaption(data.caption || '')
      setSelectedHashtags(data.hashtags?.slice(0, 5) || [])
      if (data.image_prompt) setImagePrompt(data.image_prompt)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const insertHook = (hook) => {
    setCaption(prev => hook + (prev ? '\n\n' + prev : ''))
    captionRef.current?.focus()
  }

  const insertCTA = (cta) => {
    setCaption(prev => (prev ? prev + '\n\n' + cta : cta))
    captionRef.current?.focus()
  }

  const toggleHashtag = (tag) => {
    setSelectedHashtags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    )
  }

  const getFinalCaption = () => {
    const tags = selectedHashtags.map(t => `#${t}`).join(' ')
    return caption + (tags ? '\n\n' + tags : '')
  }

  const generateImage = async () => {
    if (!imagePrompt.trim()) { toast.error('Enter an image prompt first'); return }
    setGeneratingImage(true)
    try {
      const data = await api.aiGenerateImage({ prompt: imagePrompt, style: imageStyle })
      setGeneratedImage(data.image)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setGeneratingImage(false)
    }
  }

  const savePost = async (action = 'draft') => {
    const finalCaption = getFinalCaption()
    if (!finalCaption.trim()) { toast.error('Caption is empty'); return }

    setSaving(true)
    try {
      const postData = {
        versions: [{
          is_original: true,
          account_id: null,
          content: [{ type: 'text', body: finalCaption }],
        }],
        account_ids: selectedAccounts,
        tags: [],
      }

      const created = await api.createPost(postData)

      if (action === 'draft') {
        toast.success('Saved as draft')
        router.push('/posts')
      } else {
        toast.success('Opening editor...')
        router.push(`/posts/${created.id}`)
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const charLimit = CHAR_LIMITS[platform] || 2200
  const charCount = getFinalCaption().length
  const charOver = charCount > charLimit

  return (
    <div className="ai-creator">
      {/* Header — Platform + Type */}
      <div className="ai-creator-header">
        <div className="ai-header-row">
          <div className="ai-section-label">Platform</div>
          <div className="ai-platform-tabs">
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                className={`ai-platform-tab${platform === p.id ? ' active' : ''}`}
                onClick={() => setPlatform(p.id)}
              >
                <span>{p.icon}</span>
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="ai-header-row">
          <div className="ai-section-label">Post Type</div>
          <div className="ai-chip-row">
            {POST_TYPES.map(t => (
              <button
                key={t.id}
                className={`ai-chip${postType === t.id ? ' active' : ''}`}
                onClick={() => setPostType(t.id)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="ai-creator-body">
        {/* Left column */}
        <div className="ai-creator-main">
          {/* Prompt section */}
          <div className="ai-card">
            <div className="ai-card-title">
              <span className="ai-card-icon">✨</span>
              What do you want to create?
            </div>

            <textarea
              className="form-input ai-prompt-textarea"
              placeholder="Describe your post... e.g. 'A product launch post for our new eco-friendly water bottle, targeting health-conscious millennials'"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={4}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate() }}
            />

            <div className="ai-selectors-row">
              <div className="ai-selector-group">
                <div className="ai-selector-label">Goal</div>
                <div className="ai-chip-row">
                  {GOALS.map(g => (
                    <button
                      key={g.id}
                      className={`ai-chip ai-chip-sm${goal === g.id ? ' active' : ''}`}
                      onClick={() => setGoal(g.id)}
                    >
                      {g.icon} {g.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ai-selector-group">
                <div className="ai-selector-label">Tone</div>
                <div className="ai-chip-row">
                  {TONES.map(t => (
                    <button
                      key={t.id}
                      className={`ai-chip ai-chip-sm${tone === t.id ? ' active' : ''}`}
                      onClick={() => setTone(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="ai-generate-row">
              <button
                className="btn btn-primary ai-generate-btn"
                onClick={generate}
                disabled={generating || !prompt.trim()}
              >
                {generating ? (
                  <><span className="spinner" /> Generating...</>
                ) : (
                  <>✨ Generate</>
                )}
              </button>
              {result && (
                <button
                  className="btn btn-secondary"
                  onClick={generate}
                  disabled={generating}
                >
                  🔄 Regenerate
                </button>
              )}
              <span className="ai-hint">Cmd+Enter to generate</span>
            </div>
          </div>

          {/* Results section */}
          {result && (
            <div className="ai-card ai-results animate-fade-in-up">
              <div className="ai-card-title">
                <span className="ai-card-icon">🎯</span>
                AI Suggestions
              </div>

              {/* Caption editor */}
              <div className="ai-result-section">
                <div className="ai-result-label">
                  <span>✍️ Caption</span>
                  <span className={`ai-char-count${charOver ? ' over' : ''}`}>
                    {charCount} / {charLimit}
                  </span>
                </div>
                <textarea
                  ref={captionRef}
                  className="form-input ai-caption-textarea"
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  rows={8}
                />
              </div>

              {/* Hashtags */}
              {result.hashtags?.length > 0 && (
                <div className="ai-result-section">
                  <div className="ai-result-label">🔥 Hashtags <span className="text-muted text-xs">(click to toggle)</span></div>
                  <div className="ai-hashtag-row">
                    {result.hashtags.map(tag => (
                      <button
                        key={tag}
                        className={`ai-hashtag${selectedHashtags.includes(tag) ? ' active' : ''}`}
                        onClick={() => toggleHashtag(tag)}
                      >
                        #{tag}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Hook ideas */}
              {result.hooks?.length > 0 && (
                <div className="ai-result-section">
                  <div className="ai-result-label">💡 Hook Ideas <span className="text-muted text-xs">(click to prepend)</span></div>
                  <div className="ai-suggestion-list">
                    {result.hooks.map((hook, i) => (
                      <button key={i} className="ai-suggestion-item" onClick={() => insertHook(hook)}>
                        <span className="ai-suggestion-num">{i + 1}</span>
                        <span>{hook}</span>
                        <span className="ai-suggestion-action">↑ Use</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* CTA suggestions */}
              {result.ctas?.length > 0 && (
                <div className="ai-result-section">
                  <div className="ai-result-label">📌 CTA Suggestions <span className="text-muted text-xs">(click to append)</span></div>
                  <div className="ai-suggestion-list">
                    {result.ctas.map((cta, i) => (
                      <button key={i} className="ai-suggestion-item" onClick={() => insertCTA(cta)}>
                        <span className="ai-suggestion-num">{i + 1}</span>
                        <span>{cta}</span>
                        <span className="ai-suggestion-action">↓ Add</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Image Generator */}
          <div className="ai-card">
            <div className="ai-card-title">
              <span className="ai-card-icon">🎨</span>
              Image Generator
              <span className="ai-card-badge">Optional</span>
            </div>

            <div className="form-group">
              <textarea
                className="form-input"
                placeholder="Describe the image you want to generate..."
                value={imagePrompt}
                onChange={e => setImagePrompt(e.target.value)}
                rows={3}
              />
            </div>

            <div className="ai-selector-group" style={{ marginBottom: '1rem' }}>
              <div className="ai-selector-label">Style</div>
              <div className="ai-chip-row">
                {IMAGE_STYLES.map(s => (
                  <button
                    key={s.id}
                    className={`ai-chip ai-chip-sm${imageStyle === s.id ? ' active' : ''}`}
                    onClick={() => setImageStyle(s.id)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="btn btn-secondary"
              onClick={generateImage}
              disabled={generatingImage || !imagePrompt.trim()}
            >
              {generatingImage ? <><span className="spinner" /> Generating Image...</> : '🖼️ Generate Image'}
            </button>

            {generatedImage && (
              <div className="ai-generated-image animate-fade-in">
                <img src={generatedImage} alt="AI generated" />
                <div className="ai-image-actions">
                  <a href={generatedImage} download="ai-image.png" className="btn btn-ghost btn-sm">
                    ⬇️ Download
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="ai-creator-sidebar">
          {/* Preview */}
          <div className="ai-card">
            <div className="ai-card-title">
              <span className="ai-card-icon">👁️</span>
              Preview
            </div>

            <div className="tabs" style={{ marginBottom: '1rem' }}>
              {['instagram', 'linkedin', 'twitter'].map(p => (
                <button
                  key={p}
                  className={`tab${previewTab === p ? ' active' : ''}`}
                  onClick={() => setPreviewTab(p)}
                  style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
                >
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </button>
              ))}
            </div>

            {caption || generatedImage ? (
              <div className={`ai-preview ai-preview--${previewTab}`}>
                {previewTab === 'instagram' && (
                  <div className="ai-preview-instagram">
                    <div className="ai-preview-header">
                      <div className="ai-preview-avatar" />
                      <div>
                        <div className="ai-preview-username">your_account</div>
                        <div className="ai-preview-subtext">Just now</div>
                      </div>
                    </div>
                    {generatedImage && <img src={generatedImage} alt="preview" className="ai-preview-image" />}
                    <div className="ai-preview-actions">❤️ 💬 🔖</div>
                    <div className="ai-preview-caption">
                      <strong>your_account</strong> {getFinalCaption() || <span className="text-muted">Your caption will appear here...</span>}
                    </div>
                  </div>
                )}
                {previewTab === 'linkedin' && (
                  <div className="ai-preview-linkedin">
                    <div className="ai-preview-header">
                      <div className="ai-preview-avatar" />
                      <div>
                        <div className="ai-preview-username">Your Name</div>
                        <div className="ai-preview-subtext">Your Title • Just now</div>
                      </div>
                    </div>
                    <div className="ai-preview-text">
                      {getFinalCaption() || <span className="text-muted">Your caption will appear here...</span>}
                    </div>
                    {generatedImage && <img src={generatedImage} alt="preview" className="ai-preview-image" />}
                    <div className="ai-preview-linkedin-actions">
                      <span>👍 Like</span>
                      <span>💬 Comment</span>
                      <span>🔁 Repost</span>
                    </div>
                  </div>
                )}
                {previewTab === 'twitter' && (
                  <div className="ai-preview-twitter">
                    <div className="ai-preview-header">
                      <div className="ai-preview-avatar" />
                      <div>
                        <div className="ai-preview-username">Your Name <span className="text-muted">@handle</span></div>
                        <div className="ai-preview-subtext">Just now</div>
                      </div>
                    </div>
                    <div className="ai-preview-text">
                      {getFinalCaption().slice(0, 280) || <span className="text-muted">Your caption will appear here...</span>}
                      {getFinalCaption().length > 280 && <span className="text-danger"> (truncated at 280)</span>}
                    </div>
                    {generatedImage && <img src={generatedImage} alt="preview" className="ai-preview-image" />}
                    <div className="ai-preview-twitter-actions">
                      <span>💬</span>
                      <span>🔁</span>
                      <span>❤️</span>
                      <span>📤</span>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="ai-preview-empty">
                <div style={{ fontSize: '2rem' }}>👁️</div>
                <div className="text-muted text-sm">Generate content to see a preview</div>
              </div>
            )}
          </div>

          {/* Accounts */}
          <div className="ai-card">
            <div className="ai-card-title">
              <span className="ai-card-icon">📱</span>
              Publish To
            </div>
            {accounts.length === 0 ? (
              <div className="text-muted text-sm">No connected accounts</div>
            ) : (
              <div className="ai-accounts-list">
                {accounts.map(acc => (
                  <label key={acc.id} className="ai-account-row">
                    <input
                      type="checkbox"
                      checked={selectedAccounts.includes(acc.id)}
                      onChange={() => setSelectedAccounts(prev =>
                        prev.includes(acc.id) ? prev.filter(x => x !== acc.id) : [...prev, acc.id]
                      )}
                    />
                    <span className={`provider-dot provider-dot--${acc.provider}`} />
                    <span className="ai-account-name">{acc.name || acc.username}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="ai-card ai-actions-card">
            <button
              className="btn btn-primary w-full"
              onClick={() => savePost('editor')}
              disabled={saving || !caption.trim()}
            >
              {saving ? <span className="spinner" /> : '📝'} Open in Editor
            </button>
            <button
              className="btn btn-secondary w-full"
              onClick={() => savePost('draft')}
              disabled={saving || !caption.trim()}
            >
              {saving ? <span className="spinner" /> : '💾'} Save Draft
            </button>
            <div className="ai-actions-hint text-muted text-xs">
              "Open in Editor" lets you schedule and publish to selected accounts
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
