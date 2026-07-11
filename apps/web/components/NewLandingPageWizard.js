'use client'

import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { useToast } from './Toast.js'
import { normalizePlanFromLlm, buildSeoMeta, extractLandingPagePlan } from '../lib/landingPagePlan.js'
import {
  MessageSquare, Sparkles, Wand2, Pencil, Globe,
  ChevronLeft, ChevronRight, CheckCircle2, Loader2,
} from 'lucide-react'

const PROMPT_EXAMPLES = [
  'Promote a summer sale for my clothing brand',
  'Create a landing page for my Google Ads campaign',
  'I need a page for my new restaurant',
  'Collect emails for my SaaS waitlist',
]

const DEFAULT_FIELDS = [
  { name: 'name', type: 'text', label: 'Full Name', required: true },
  { name: 'email', type: 'email', label: 'Email Address', required: true },
  { name: 'phone', type: 'tel', label: 'Phone Number', required: false },
]

const STEPS = [
  { id: 'mind', label: 'Describe', icon: MessageSquare },
  { id: 'plan', label: 'AI Plan', icon: Sparkles },
  { id: 'generate', label: 'Generate', icon: Wand2 },
  { id: 'editor', label: 'Editor', icon: Pencil },
  { id: 'publish', label: 'Publish', icon: Globe },
]

function StepIndicator({ steps, currentIndex }) {
  return (
    <div className="post-wizard-steps" style={{ padding: '0.75rem 1rem 0.35rem' }}>
      {steps.map((step, i) => {
        const Icon = step.icon
        const done = i < currentIndex
        const active = i === currentIndex
        return (
          <div key={step.id} className={`post-wizard-step${active ? ' active' : ''}${done ? ' done' : ''}`} style={{ maxWidth: 88 }}>
            <div className="post-wizard-step-dot">
              {done ? <CheckCircle2 size={16} strokeWidth={2.5} /> : <Icon size={14} strokeWidth={2.2} />}
            </div>
            <span className="post-wizard-step-label">{step.label}</span>
            {i < steps.length - 1 && <div className="post-wizard-step-line" />}
          </div>
        )
      })}
    </div>
  )
}

const EMPTY_EDITOR = {
  title: '',
  headline: '',
  subheadline: '',
  body: '',
  cta_text: 'Get Started',
  form_fields: DEFAULT_FIELDS,
  meta_title: '',
  meta_description: '',
  meta_keywords: '',
}

export default function NewLandingPageWizard({ onClose, onDone }) {
  const toast = useToast()

  const [step, setStep] = useState(0)
  const [prompt, setPrompt] = useState('')
  const [plan, setPlan] = useState(null)
  const [planning, setPlanning] = useState(false)
  const [needsFollowUp, setNeedsFollowUp] = useState(false)
  const [followUpAnswers, setFollowUpAnswers] = useState({})
  const [planEditing, setPlanEditing] = useState(false)

  const [generating, setGenerating] = useState(false)
  const [pageId, setPageId] = useState(null)
  const [slug, setSlug] = useState('')
  const [editor, setEditor] = useState(EMPTY_EDITOR)

  const [publishing, setPublishing] = useState(false)

  const [campaigns, setCampaigns] = useState([])

  useEffect(() => {
    api.campaigns({ per_page: 100 }).then(r => setCampaigns(r.items || [])).catch(() => {})
  }, [])

  const planFromLlm = async (sourcePrompt, answers = null) => {
    const body = { prompt: sourcePrompt.trim() }
    if (answers && Object.keys(answers).length) {
      body.follow_up_answers = answers
    }
    try {
      const data = await api.aiPlanLandingPage(body)
      return normalizePlanFromLlm(data, sourcePrompt)
    } catch (err) {
      toast.error(err.message || 'AI planning failed — using a basic draft plan')
      const heuristic = extractLandingPagePlan({ prompt: sourcePrompt })
      return normalizePlanFromLlm({
        ...heuristic,
        follow_up_questions: heuristic.followUpQuestions,
      })
    }
  }

  const buildPlan = async (sourcePrompt = prompt) => {
    if (!sourcePrompt.trim()) {
      toast.error('Tell us what you want to create')
      return false
    }
    setPlanning(true)
    try {
      const extracted = await planFromLlm(sourcePrompt)
      setPlan(extracted)
      setNeedsFollowUp((extracted.followUpQuestions || []).length > 0)
      setFollowUpAnswers({})
      setPlanEditing(false)
      return true
    } finally {
      setPlanning(false)
    }
  }

  const completeFollowUps = async () => {
    const questions = plan?.followUpQuestions || []
    for (const q of questions) {
      if (!followUpAnswers[q.id]?.trim()) {
        toast.error('Please answer the follow-up questions')
        return false
      }
    }
    setPlanning(true)
    try {
      const extracted = await planFromLlm(prompt, followUpAnswers)
      setPlan(extracted)
      const stillNeeds = (extracted.followUpQuestions || []).length > 0
      setNeedsFollowUp(stillNeeds)
      setPlanEditing(false)
      return !stillNeeds
    } finally {
      setPlanning(false)
    }
  }

  const runGenerate = async () => {
    if (!plan?.title?.trim()) {
      toast.error('Page title is required')
      return false
    }
    setGenerating(true)
    try {
      const keywords = Array.isArray(plan.seo_keywords)
        ? plan.seo_keywords
        : String(plan.keywords || '').split(',').map(k => k.trim()).filter(Boolean)
      const out = await api.runLandingPageWorkflow({
        title: plan.title.trim(),
        slug: plan.slug || undefined,
        campaign_id: plan.campaign_id || undefined,
        language: plan.language || 'en',
        keywords,
        offer: plan.offer,
        audience: plan.audience,
        tone: plan.tone,
        business: plan.business,
        publish: false,
      })
      const lp = out.landing_page || {}
      const content = out.content || {}
      const seo = buildSeoMeta({
        headline: lp.headline || content.headline,
        subheadline: lp.subheadline || content.subheadline,
        body: lp.body || content.body,
        keywords: plan.seo_keywords || plan.keywords,
      })
      setPageId(lp.id)
      setSlug(out.slug || lp.slug)
      setEditor({
        title: lp.title || plan.title,
        headline: lp.headline || content.headline || plan.headline_hint,
        subheadline: lp.subheadline || content.subheadline || '',
        body: lp.body || content.body || plan.key_message,
        cta_text: lp.cta_text || content.cta_text || 'Get Started',
        form_fields: lp.form_fields?.length ? lp.form_fields : DEFAULT_FIELDS,
        meta_title: seo.meta_title,
        meta_description: seo.meta_description,
        meta_keywords: seo.meta_keywords,
      })
      toast.success('Landing page content generated')
      return true
    } catch (err) {
      toast.error(err.message || 'Generation failed')
      return false
    } finally {
      setGenerating(false)
    }
  }

  const saveEditor = async () => {
    if (!pageId) return false
    try {
      await api.updateLandingPage(pageId, {
        title: editor.title,
        headline: editor.headline,
        subheadline: editor.subheadline,
        body: editor.body,
        cta_text: editor.cta_text,
        form_fields: editor.form_fields,
        meta: {
          meta_title: editor.meta_title,
          meta_description: editor.meta_description,
          meta_keywords: editor.meta_keywords,
          generated: true,
        },
      })
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    }
  }

  const finishWizard = () => {
    onDone?.()
    onClose?.()
  }

  const handlePublish = async () => {
    if (!pageId) return
    setPublishing(true)
    try {
      const ok = await saveEditor()
      if (!ok) return
      await api.updateLandingPage(pageId, { status: 'published' })
      toast.success('Landing page published')
      finishWizard()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setPublishing(false)
    }
  }

  const saveDraft = async () => {
    if (!pageId) return
    setPublishing(true)
    try {
      const ok = await saveEditor()
      if (!ok) return
      toast.success('Draft saved')
      finishWizard()
    } finally {
      setPublishing(false)
    }
  }

  const canNext = () => {
    if (step === 0) return prompt.trim().length >= 10
    if (step === 1) {
      if (needsFollowUp) {
        return (plan?.followUpQuestions || []).every(q => followUpAnswers[q.id]?.trim())
      }
      return Boolean(plan?.title?.trim())
    }
    if (step === 2) return Boolean(pageId)
    if (step === 3) return editor.title.trim() && editor.headline.trim()
    return true
  }

  const continueFromPlan = async () => {
    if (!plan?.title?.trim()) {
      toast.error('Page title is required')
      return
    }
    setStep(2)
    const ok = await runGenerate()
    if (ok) setStep(3)
  }

  const updateSeoKeyword = (index, value) => {
    setPlan(p => {
      const next = [...(p.seo_keywords || [])]
      next[index] = value
      return { ...p, seo_keywords: next, keywords: next.filter(Boolean).join(', ') }
    })
  }

  const updateAssumption = (index, value) => {
    setPlan(p => {
      const next = [...(p.assumptions || [])]
      next[index] = value
      return { ...p, assumptions: next }
    })
  }

  const goNext = async () => {
    if (step === 0) {
      const ok = await buildPlan()
      if (ok) setStep(1)
      return
    }
    if (step === 1) {
      if (needsFollowUp) {
        const ok = await completeFollowUps()
        if (!ok) return
        return
      }
      if (planEditing) {
        setPlanEditing(false)
        return
      }
      await continueFromPlan()
      return
    }
    if (step === 2) {
      if (pageId) setStep(3)
      return
    }
    if (step === 3) {
      const ok = await saveEditor()
      if (ok) setStep(4)
      return
    }
    if (step === 4) return
  }

  const goBack = () => {
    if (step === 1 && planEditing) { setPlanEditing(false); return }
    setStep(s => Math.max(0, s - 1))
  }

  const updateField = (i, key, value) => {
    setEditor(f => ({
      ...f,
      form_fields: f.form_fields.map((fd, idx) => idx === i ? { ...fd, [key]: value } : fd),
    }))
  }

  return (
    <div className="post-wizard">
      <StepIndicator steps={STEPS} currentIndex={step} />

      <div className="post-wizard-body">
        {step === 0 && (
          <div className="post-wizard-panel animate-fade-in-up lp-wizard-chat">
            <div className="lp-wizard-chat-header">
              <Sparkles size={20} strokeWidth={2} />
              <h2 className="post-wizard-title" style={{ margin: 0 }}>Describe what you want to create</h2>
            </div>
            <p className="post-wizard-sub" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
              Tell us in your own words — we&apos;ll figure out the goal, tone, and structure.
            </p>

            <div className="lp-wizard-examples">
              <div className="lp-wizard-examples-label">Examples</div>
              <ul className="lp-wizard-examples-list">
                {PROMPT_EXAMPLES.map(example => (
                  <li key={example}>
                    <button
                      type="button"
                      className="lp-wizard-example-btn"
                      onClick={() => setPrompt(example)}
                    >
                      {example}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <textarea
              className="form-input lp-wizard-chat-input"
              rows={6}
              placeholder="Tell me about your business…"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {step === 1 && plan && needsFollowUp && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">Quick follow-up</h2>
            <p className="post-wizard-sub">I need a bit more context to build a solid plan.</p>
            <div className="post-wizard-generated-preview" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {plan.followUpQuestions.map(q => (
                <div key={q.id} className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">{q.label}</label>
                  <input
                    className="form-input"
                    placeholder={q.placeholder}
                    value={followUpAnswers[q.id] || ''}
                    onChange={e => setFollowUpAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 1 && plan && !needsFollowUp && !planEditing && (
          <div className="post-wizard-panel animate-fade-in-up lp-wizard-plan">
            <h2 className="lp-wizard-plan-heading">Here&apos;s what I understood</h2>

            <div className="lp-wizard-plan-card">
              <div className="lp-wizard-plan-row">
                <span className="lp-wizard-plan-label">Page title</span>
                <span className="lp-wizard-plan-value">{plan.title}</span>
              </div>
              <div className="lp-wizard-plan-row">
                <span className="lp-wizard-plan-label">URL</span>
                <span className="lp-wizard-plan-value" style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  /lp/{plan.slug}
                </span>
              </div>
              <div className="lp-wizard-plan-row">
                <span className="lp-wizard-plan-label">Language</span>
                <span className="lp-wizard-plan-value">{plan.language_label || plan.language}</span>
              </div>
              <div className="lp-wizard-plan-row">
                <span className="lp-wizard-plan-label">Business</span>
                <span className="lp-wizard-plan-value">{plan.business}</span>
              </div>
              <div className="lp-wizard-plan-row">
                <span className="lp-wizard-plan-label">Goal</span>
                <span className="lp-wizard-plan-value">{plan.goal}</span>
              </div>
              <div className="lp-wizard-plan-row">
                <span className="lp-wizard-plan-label">Audience</span>
                <span className="lp-wizard-plan-value">{plan.audience}</span>
              </div>
              <div className="lp-wizard-plan-row">
                <span className="lp-wizard-plan-label">Offer</span>
                <span className="lp-wizard-plan-value">{plan.offer}</span>
              </div>
              <div className="lp-wizard-plan-row">
                <span className="lp-wizard-plan-label">Tone</span>
                <span className="lp-wizard-plan-value">{plan.tone}</span>
              </div>
              <div className="lp-wizard-plan-row lp-wizard-plan-row--seo">
                <span className="lp-wizard-plan-label">SEO</span>
                <div className="lp-wizard-plan-seo">
                  {(plan.seo_keywords || []).map(kw => (
                    <span key={kw} className="lp-wizard-plan-seo-tag">{kw}</span>
                  ))}
                </div>
              </div>
            </div>

            {(plan.assumptions || []).length > 0 && (
              <div className="lp-wizard-plan-assumptions">
                <div className="lp-wizard-plan-label">Assumptions</div>
                <ul>
                  {plan.assumptions.map(a => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="lp-wizard-plan-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setPlanEditing(true)}>
                Edit anything
              </button>
              <button type="button" className="btn btn-primary" onClick={continueFromPlan} disabled={generating}>
                {generating ? <><Loader2 size={16} className="spinner" /> Generating…</> : <>Continue <ChevronRight size={16} /></>}
              </button>
            </div>
          </div>
        )}

        {step === 1 && plan && !needsFollowUp && planEditing && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">Edit your plan</h2>
            <p className="post-wizard-sub">Adjust anything before we generate the page.</p>
            <div className="post-wizard-generated-preview" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Page title</label>
                <input className="form-input" value={plan.title} onChange={e => setPlan(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">URL slug</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span className="text-muted text-sm">/lp/</span>
                  <input
                    className="form-input"
                    style={{ marginBottom: 0 }}
                    value={plan.slug || ''}
                    onChange={e => setPlan(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') }))}
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Business</label>
                <input className="form-input" value={plan.business} onChange={e => setPlan(p => ({ ...p, business: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Goal</label>
                <input className="form-input" value={plan.goal} onChange={e => setPlan(p => ({ ...p, goal: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Audience</label>
                <input className="form-input" value={plan.audience} onChange={e => setPlan(p => ({ ...p, audience: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Offer</label>
                <input className="form-input" value={plan.offer} onChange={e => setPlan(p => ({ ...p, offer: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Tone</label>
                <input className="form-input" value={plan.tone} onChange={e => setPlan(p => ({ ...p, tone: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">SEO keywords</label>
                {(plan.seo_keywords || []).map((kw, i) => (
                  <input
                    key={i}
                    className="form-input"
                    style={{ marginBottom: '0.35rem' }}
                    value={kw}
                    onChange={e => updateSeoKeyword(i, e.target.value)}
                  />
                ))}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Assumptions</label>
                {(plan.assumptions || []).map((a, i) => (
                  <input
                    key={i}
                    className="form-input"
                    style={{ marginBottom: '0.35rem' }}
                    value={a}
                    onChange={e => updateAssumption(i, e.target.value)}
                  />
                ))}
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Link to campaign (optional)</label>
                <select className="form-input" value={plan.campaign_id} onChange={e => setPlan(p => ({ ...p, campaign_id: e.target.value }))}>
                  <option value="">— None —</option>
                  {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="lp-wizard-plan-actions" style={{ marginTop: '1rem' }}>
              <button type="button" className="btn btn-secondary" onClick={() => setPlanEditing(false)}>
                Back to summary
              </button>
              <button type="button" className="btn btn-primary" onClick={() => { setPlanEditing(false) }}>
                Done editing
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="post-wizard-panel animate-fade-in-up" style={{ textAlign: 'center', paddingTop: '2rem' }}>
            <h2 className="post-wizard-title">Generate Landing Page</h2>
            <p className="post-wizard-sub">AI is writing your headline, body copy, CTA, and SEO assets.</p>
            {generating ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', marginTop: '2rem' }}>
                <Loader2 size={40} className="spinner" style={{ color: 'hsl(262 68% 58%)' }} />
                <p className="text-muted text-sm">Generating content for &ldquo;{plan?.title}&rdquo;…</p>
              </div>
            ) : pageId ? (
              <div className="post-wizard-generated-preview" style={{ textAlign: 'left', marginTop: '1rem' }}>
                <div style={{ fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.35rem' }}>{editor.headline}</div>
                {editor.subheadline && <div className="text-muted text-sm" style={{ marginBottom: '0.75rem' }}>{editor.subheadline}</div>}
                <p className="text-sm" style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{editor.body}</p>
                <div style={{ marginTop: '1rem', fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
                  SEO title: {editor.meta_title || '—'}<br />
                  Meta description: {editor.meta_description || '—'}
                </div>
              </div>
            ) : (
              <button type="button" className="btn btn-primary" style={{ marginTop: '1.5rem' }} onClick={runGenerate}>
                <Wand2 size={16} /> Generate now
              </button>
            )}
          </div>
        )}

        {step === 3 && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">Landing Page Editor</h2>
            <p className="post-wizard-sub">Edit every section before publishing.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Page title</label>
                <input className="form-input" value={editor.title} onChange={e => setEditor(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Headline</label>
                <input className="form-input" value={editor.headline} onChange={e => setEditor(f => ({ ...f, headline: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Subheadline</label>
                <input className="form-input" value={editor.subheadline} onChange={e => setEditor(f => ({ ...f, subheadline: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Body</label>
                <textarea className="form-input" rows={4} value={editor.body} onChange={e => setEditor(f => ({ ...f, body: e.target.value }))} />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">CTA button</label>
                <input className="form-input" value={editor.cta_text} onChange={e => setEditor(f => ({ ...f, cta_text: e.target.value }))} />
              </div>
              <div style={{ borderTop: '1px solid hsl(var(--border)/0.5)', paddingTop: '0.75rem' }}>
                <div className="form-label" style={{ marginBottom: '0.5rem' }}>SEO</div>
                <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                  <input className="form-input" placeholder="Meta title" value={editor.meta_title} onChange={e => setEditor(f => ({ ...f, meta_title: e.target.value }))} />
                </div>
                <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                  <textarea className="form-input" rows={2} placeholder="Meta description" value={editor.meta_description} onChange={e => setEditor(f => ({ ...f, meta_description: e.target.value }))} />
                </div>
                <input className="form-input" placeholder="Meta keywords" value={editor.meta_keywords} onChange={e => setEditor(f => ({ ...f, meta_keywords: e.target.value }))} />
              </div>
              <div>
                <div className="form-label">Lead form fields</div>
                {editor.form_fields.map((fd, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 70px', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <input className="form-input" style={{ marginBottom: 0 }} value={fd.label} onChange={e => updateField(i, 'label', e.target.value)} />
                    <select className="form-input" style={{ marginBottom: 0 }} value={fd.type} onChange={e => updateField(i, 'type', e.target.value)}>
                      <option value="text">Text</option>
                      <option value="email">Email</option>
                      <option value="tel">Phone</option>
                      <option value="textarea">Textarea</option>
                    </select>
                    <select className="form-input" style={{ marginBottom: 0 }} value={fd.required ? 'yes' : 'no'} onChange={e => updateField(i, 'required', e.target.value === 'yes')}>
                      <option value="yes">Req</option>
                      <option value="no">Opt</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="post-wizard-panel animate-fade-in-up">
            <h2 className="post-wizard-title">Publish</h2>
            <p className="post-wizard-sub">Your page is ready. Publish to start capturing leads.</p>
            <div className="post-wizard-preview-card" style={{ marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, fontSize: '1.15rem', marginBottom: '0.35rem' }}>{editor.headline}</div>
              {editor.subheadline && <div className="text-muted text-sm" style={{ marginBottom: '0.75rem' }}>{editor.subheadline}</div>}
              <p className="text-sm" style={{ lineHeight: 1.6 }}>{editor.body}</p>
              <button type="button" className="btn btn-primary btn-sm" style={{ marginTop: '1rem' }} disabled>{editor.cta_text}</button>
            </div>
            {slug && (
              <p className="text-sm text-muted" style={{ marginBottom: '1rem' }}>
                Public URL: <code>/lp/{slug}</code>
              </p>
            )}
            <div className="post-wizard-action-row">
              <button type="button" className="btn btn-secondary" onClick={saveDraft} disabled={publishing}>
                Save as draft
              </button>
              <button type="button" className="btn btn-primary" onClick={handlePublish} disabled={publishing}>
                {publishing ? <Loader2 size={16} className="spinner" /> : <><Globe size={15} /> Publish page</>}
              </button>
            </div>
          </div>
        )}

      </div>

      <div className="post-wizard-footer">
        <button type="button" className="btn btn-ghost" onClick={step === 0 ? onClose : goBack} disabled={generating || planning}>
          <ChevronLeft size={16} /> {step === 0 ? 'Close' : 'Back'}
        </button>
        <div style={{ flex: 1 }} />
        {step < 4 && !(step === 1 && !needsFollowUp && !planEditing) && (
          <button type="button" className="btn btn-primary" onClick={goNext} disabled={!canNext() || generating || planning}>
            {planning ? <><Loader2 size={16} className="spinner" /> Analyzing…</> : generating ? <><Loader2 size={16} className="spinner" /> Generating…</> : step === 1 && needsFollowUp ? <>Continue <ChevronRight size={16} /></> : step === 1 && planEditing ? 'Done editing' : <>Next <ChevronRight size={16} /></>}
          </button>
        )}
      </div>
    </div>
  )
}
