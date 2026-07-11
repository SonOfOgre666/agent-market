'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import {
  buildGoogleCampaignPayload,
  normalizeGoogleFormValues,
  validateGooglePublishReady,
  validateGoogleWorkflowStep,
} from '../../lib/googleAdsWorkflow.js'
import {
  fetchGoogleAdAccountProfile,
  listGoogleAdGroups,
  listGoogleCampaigns,
  runGoogleTool,
} from '../../lib/googleAdsTools.js'
import {
  GOOGLE_TOOL_CATEGORIES,
  GOOGLE_TOOLS,
  GOOGLE_WIZARD_MODES,
  toolsByCategory,
} from '../../lib/googleAdsToolCatalog.js'
import { GOOGLE_CAMPAIGN_TYPES, campaignTypeMeta, googlePublishToolForType, isSearchCampaignType } from '../../lib/googleCampaignTypes.js'
import { googleRsaDraft, validateGoogleRsaForPublish } from '../../lib/googleRsaValidation.js'
import GoogleAdCreativeFields from './GoogleAdCreativeFields.js'
import GoogleAdGroupFields from './GoogleAdGroupFields.js'
import GoogleAdsToolRunner from './GoogleAdsToolRunner.js'
import GoogleExtensionsFields from './GoogleExtensionsFields.js'
import GoogleKeywordFields from './GoogleKeywordFields.js'
import GoogleReviewSummary from './GoogleReviewSummary.js'
import GoogleRsaPublishChecklist from './GoogleRsaPublishChecklist.js'
import GoogleTargetingFields from './GoogleTargetingFields.js'
import GoogleAdvancedFields from './GoogleAdvancedFields.js'
import { GOOGLE_SMART_CHAINS } from '../../lib/googleAdsSmartChains.js'
import { ChevronLeft, ChevronRight, Layers, Wrench, Sparkles } from 'lucide-react'

/** Granular steps — search gets full RSA chain; other types stop after geo (no RSA/keywords). */
const GRANULAR_PIPELINE_SEARCH = [
  'google_create_budget',
  'google_create_typed_campaign',
  'google_create_adgroup',
  'google_add_keywords',
  'google_create_ad',
  'google_create_geo_targeting',
  'google_add_negative_keywords',
  'google_create_sitelink_extensions',
  'google_create_callout_extensions',
]

const GRANULAR_PIPELINE_TYPED = (type) => [
  googlePublishToolForType(type),
  'google_create_sitelink_extensions',
  'google_create_callout_extensions',
]

function defaultValue(field) {
  if (field.type === 'select' && field.options?.length) return field.options[0].value
  return ''
}

export default function GoogleAdsCampaignWizard({ onCancel, onComplete, onToast }) {
  const [schema, setSchema] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [values, setValues] = useState({ wizard_mode: 'guided', type: 'search' })
  const [adAccounts, setAdAccounts] = useState([])
  const [profile, setProfile] = useState(null)
  const [campaignOptions, setCampaignOptions] = useState([])
  const [adGroupOptions, setAdGroupOptions] = useState([])
  const [saving, setSaving] = useState(false)
  const [toolCategory, setToolCategory] = useState('campaigns')
  const [selectedTool, setSelectedTool] = useState(GOOGLE_TOOLS.find((t) => t.ref === 'create_campaign'))
  const [contextIds, setContextIds] = useState({ platformCampaignId: '', platformAdSetId: '', budgetResourceName: '' })
  const [toolLog, setToolLog] = useState([])
  const [activeChainId, setActiveChainId] = useState(null)

  const mode = values.wizard_mode || 'guided'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const [sch, accts] = await Promise.all([
          api.adsWorkflowSchema('google_ads'),
          api.adAccounts(),
        ])
        if (cancelled) return
        setSchema(sch)
        const initial = { wizard_mode: 'guided', type: 'search' }
        for (const st of sch?.steps || []) {
          for (const field of st.fields || []) {
            initial[field.name] = defaultValue(field)
          }
        }
        setValues((v) => ({ ...initial, ...v }))
        setAdAccounts((accts?.items || []).filter((a) => a.provider === 'google_ads'))
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const setField = (name, value) => setValues((v) => ({ ...v, [name]: value }))

  const refreshContext = useCallback(async () => {
    const aid = values.account_id
    if (!aid) return
    try {
      const { profile: p } = await fetchGoogleAdAccountProfile(aid)
      setProfile(p)
      const camps = await listGoogleCampaigns(aid, { limit: 80 })
      setCampaignOptions(camps || [])
      if (contextIds.platformCampaignId) {
        const ags = await listGoogleAdGroups(aid, { campaignId: contextIds.platformCampaignId })
        setAdGroupOptions(ags || [])
      } else {
        setAdGroupOptions([])
      }
    } catch {
      setCampaignOptions([])
    }
  }, [values.account_id, contextIds.platformCampaignId])

  useEffect(() => {
    refreshContext()
  }, [refreshContext])

  const steps = mode === 'tools' ? [] : (schema?.steps || [])
  const step = steps[stepIndex]
  const isLast = stepIndex >= steps.length - 1

  const toolContext = useMemo(
    () => ({
      accountId: values.account_id,
      platformCampaignId: contextIds.platformCampaignId,
      platformAdSetId: contextIds.platformAdSetId,
    }),
    [values.account_id, contextIds],
  )

  const googleStepValidation = useMemo(() => {
    if (!step?.id || step.id === 'review') return { ok: true, errors: [] }
    return validateGoogleWorkflowStep(step.id, values)
  }, [step?.id, values])

  const validateStep = () => {
    if (!step || step.id === 'review') return true
    for (const field of step.fields || []) {
      if (!field.required) continue
      const val = field.type === 'ad_account' ? values.account_id : values[field.name]
      if (val === '' || val == null) return false
    }
    return googleStepValidation.ok
  }

  const finishCreate = async (alsoPublish) => {
    if (!(values.name || '').trim() || !values.account_id) {
      setError('Name and account are required')
      return
    }
    if (alsoPublish) {
      const { ok, errors: pubErrs } = validateGooglePublishReady(normalizeGoogleFormValues(values))
      if (!ok) {
        setError(pubErrs[0])
        return
      }
    }
    setSaving(true)
    setError(null)
    try {
      const created = await api.createCampaign(buildGoogleCampaignPayload(values))
      if (alsoPublish) {
        await api.publishCampaign(created.id)
        onToast?.('Campaign saved and publish queued to Google Ads')
      } else {
        onToast?.('Campaign draft saved')
      }
      await onComplete?.(created, { published: alsoPublish })
    } catch (e) {
      setError(e.message)
      onToast?.(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleToolResult = (tool, out) => {
    setToolLog((log) => [{ tool: tool.toolId, at: new Date().toISOString(), out }, ...log].slice(0, 20))
    if (out?.platform_campaign_id) {
      setContextIds((c) => ({ ...c, platformCampaignId: String(out.platform_campaign_id) }))
    }
    if (out?.platform_ad_set_id) {
      setContextIds((c) => ({ ...c, platformAdSetId: String(out.platform_ad_set_id) }))
    }
    if (out?.budget_resource_name) {
      setContextIds((c) => ({ ...c, budgetResourceName: out.budget_resource_name }))
    }
    if (out?.campaign?.platform_campaign_id) {
      setContextIds((c) => ({ ...c, platformCampaignId: String(out.campaign.platform_campaign_id) }))
    }
    if (out?.audience_id) {
      setField('audience_id', String(out.audience_id))
    }
  }

  const applySmartChain = (chainId) => {
    const chain = GOOGLE_SMART_CHAINS.find((c) => c.id === chainId)
    if (!chain?.toolIds?.length) return
    setActiveChainId(chainId)
    const first = GOOGLE_TOOLS.find((t) => t.toolId === chain.toolIds[0])
    if (first) {
      setSelectedTool(first)
      setToolCategory(first.category)
    }
    onToast?.(`Chain: ${chain.label} — run tools in order; IDs flow via context bar`, 'success')
  }

  const typeMeta = campaignTypeMeta(values.type)
  const granularPipeline = isSearchCampaignType(values.type)
    ? GRANULAR_PIPELINE_SEARCH
    : GRANULAR_PIPELINE_TYPED(values.type)

  const renderGuidedStep = () => {
    if (step?.id === 'goal') {
      const meta = campaignTypeMeta(values.type)
      return (
        <>
          <div className="form-group">
            <label className="form-label">Advertising channel *</label>
            <select
              className="form-input"
              value={values.type ?? 'search'}
              onChange={(e) => setField('type', e.target.value)}
            >
              {GOOGLE_CAMPAIGN_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', margin: 0 }}>
            {meta.description}
          </p>
        </>
      )
    }
    if (step?.id === 'review') {
      return (
        <>
          <GoogleRsaPublishChecklist values={values} />
          <GoogleReviewSummary values={values} />
        </>
      )
    }
    if (step?.id === 'targeting') return <GoogleTargetingFields values={values} setField={setField} />
    if (step?.id === 'adgroup') {
      if (!typeMeta.needsAdGroup) {
        return (
          <p style={{ fontSize: '0.85rem', color: 'var(--fg-muted)' }}>
            {typeMeta.label} uses asset groups instead of classic ad groups. Creatives are included in the full publish chain.
          </p>
        )
      }
      return (
        <>
          <GoogleAdGroupFields values={values} setField={setField} />
          {typeMeta.needsKeywords && <GoogleKeywordFields values={values} setField={setField} />}
        </>
      )
    }
    if (step?.id === 'extensions') return <GoogleExtensionsFields values={values} setField={setField} />
    if (step?.id === 'advanced') return <GoogleAdvancedFields values={values} setField={setField} />
    if (step?.id === 'ads') {
      const rsa = googleRsaDraft(normalizeGoogleFormValues(values))
      const showRsaExtras = isSearchCampaignType(values.type)
      return (
        <>
          {(step.fields || []).map((field) => (
            <div key={field.name} className="form-group">
              <label className="form-label">{field.label} *</label>
              <textarea
                className="form-input"
                rows={field.name === 'headlines' ? 5 : 3}
                value={values[field.name] ?? ''}
                onChange={(e) => setField(field.name, e.target.value)}
              />
              <p style={{ fontSize: '0.72rem', color: 'var(--fg-muted)' }}>
                {field.name === 'headlines'
                  ? `${rsa.headlines.length} headline(s)${showRsaExtras ? ' — 3–15 for Search RSA' : ''}`
                  : `${rsa.descriptions.length} description(s)${showRsaExtras ? ' — 2–4 for Search RSA' : ''}`}
              </p>
            </div>
          ))}
          {showRsaExtras && <GoogleAdCreativeFields values={values} setField={setField} />}
          {!showRsaExtras && (
            <p style={{ fontSize: '0.78rem', color: 'var(--fg-muted)', marginTop: '0.5rem' }}>
              Publish tool: <code>{typeMeta.publishTool}</code>. Images for Display/PMax can be added via Tool console
              (<code>google_upload_image_asset</code>) or base64 in <code>creatives.*_image_data</code> on execute.
            </p>
          )}
        </>
      )
    }
    return (step?.fields || []).map((field) => (
      <div key={field.name} className="form-group">
        <label className="form-label">{field.label}{field.required ? ' *' : ''}</label>
        {field.name === 'account_id' || field.type === 'ad_account' ? (
          <select
            className="form-input"
            value={values.account_id ?? ''}
            onChange={(e) => setField('account_id', e.target.value)}
            required
          >
            <option value="">Select Google Ads account…</option>
            {adAccounts.map((a) => (
              <option key={a.account_id} value={a.account_id}>
                {a.ad_account_name || a.account_name}
              </option>
            ))}
          </select>
        ) : field.type === 'select' ? (
          <select
            className="form-input"
            value={values[field.name] ?? ''}
            onChange={(e) => setField(field.name, e.target.value)}
          >
            {(field.options || []).map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        ) : (
          <input
            className="form-input"
            type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
            value={values[field.name] ?? ''}
            onChange={(e) => setField(field.name, e.target.value)}
          />
        )}
      </div>
    ))
  }

  if (loading) return <div className="skeleton" style={{ height: 280 }} />
  if (error && !schema) return <p style={{ color: 'var(--danger)' }}>{error}</p>

  return (
    <div className="google-ads-wizard">
      <div
        className="card"
        style={{
          marginBottom: '1rem',
          padding: '0.85rem 1rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
          background: 'linear-gradient(135deg, rgba(66,133,244,0.08), transparent)',
        }}
      >
        <div style={{ flex: '1 1 200px' }}>
          <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Google Ads — reference tools</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)' }}>
            {GOOGLE_TOOLS.filter((t) => t.implemented && t.toolId).length} / {GOOGLE_TOOLS.length} reference tools live via{' '}
            <code>POST /ads/tools/execute</code>
          </div>
        </div>
        {GOOGLE_WIZARD_MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`btn ${mode === m.id ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8rem' }}
            onClick={() => {
              setField('wizard_mode', m.id)
              setStepIndex(0)
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div
        className="card"
        style={{
          marginBottom: '1rem',
          padding: '0.75rem 1rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: '0.5rem',
          fontSize: '0.78rem',
        }}
      >
        <div>
          <span style={{ color: 'var(--fg-muted)' }}>Account</span>
          <div style={{ fontWeight: 500 }}>{profile?.name || values.account_id || '—'}</div>
        </div>
        <div>
          <span style={{ color: 'var(--fg-muted)' }}>Campaign ID</span>
          <input
            className="form-input"
            style={{ marginTop: '0.2rem', padding: '0.25rem 0.4rem', fontSize: '0.75rem' }}
            value={contextIds.platformCampaignId}
            onChange={(e) => setContextIds((c) => ({ ...c, platformCampaignId: e.target.value }))}
            placeholder="from publish / list"
          />
        </div>
        <div>
          <span style={{ color: 'var(--fg-muted)' }}>Ad group ID</span>
          <input
            className="form-input"
            style={{ marginTop: '0.2rem', padding: '0.25rem 0.4rem', fontSize: '0.75rem' }}
            value={contextIds.platformAdSetId}
            onChange={(e) => setContextIds((c) => ({ ...c, platformAdSetId: e.target.value }))}
          />
        </div>
        <div>
          <span style={{ color: 'var(--fg-muted)' }}>Budget RN</span>
          <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', wordBreak: 'break-all' }}>
            {contextIds.budgetResourceName || '—'}
          </div>
        </div>
        <button type="button" className="btn btn-secondary" style={{ alignSelf: 'end', fontSize: '0.75rem' }} onClick={refreshContext}>
          Refresh IDs
        </button>
      </div>

      {mode === 'tools' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="card" style={{ padding: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.5rem', fontWeight: 600, fontSize: '0.85rem' }}>
              <Sparkles size={16} /> Smart chains
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {GOOGLE_SMART_CHAINS.map((chain) => (
                <button
                  key={chain.id}
                  type="button"
                  className={`btn btn-sm ${activeChainId === chain.id ? 'btn-primary' : 'btn-secondary'}`}
                  title={chain.description}
                  onClick={() => applySmartChain(chain.id)}
                >
                  {chain.label}
                </button>
              ))}
            </div>
            {activeChainId && (
              <p style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', margin: '0.5rem 0 0' }}>
                {GOOGLE_SMART_CHAINS.find((c) => c.id === activeChainId)?.description}
                {' — '}
                {(GOOGLE_SMART_CHAINS.find((c) => c.id === activeChainId)?.toolIds || []).join(' → ')}
              </p>
            )}
          </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(280px, 2fr)', gap: '1rem' }}>
          <div className="card" style={{ padding: '0.75rem', maxHeight: 520, overflow: 'auto' }}>
            {GOOGLE_TOOL_CATEGORIES.map((cat) => (
              <div key={cat.id} style={{ marginBottom: '0.75rem' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    fontWeight: 600,
                    fontSize: '0.8rem',
                    background: toolCategory === cat.id ? 'var(--surface-2)' : 'transparent',
                  }}
                  onClick={() => setToolCategory(cat.id)}
                >
                  {cat.icon} {cat.label}
                </button>
                {toolCategory === cat.id && (
                  <div style={{ marginLeft: '0.5rem', marginTop: '0.25rem' }}>
                    {toolsByCategory(cat.id).map((t) => (
                      <button
                        key={t.ref}
                        type="button"
                        className="btn btn-ghost"
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          fontSize: '0.75rem',
                          opacity: t.implemented ? 1 : 0.5,
                          color: selectedTool?.ref === t.ref ? 'var(--accent)' : undefined,
                        }}
                        onClick={() => setSelectedTool(t)}
                      >
                        {t.label}
                        {!t.implemented && ' ⏳'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <GoogleAdsToolRunner
              tool={selectedTool}
              context={toolContext}
              onResult={handleToolResult}
              onToast={onToast}
            />
            {toolLog.length > 0 && (
              <div className="card" style={{ padding: '0.75rem', maxHeight: 160, overflow: 'auto' }}>
                <div style={{ fontWeight: 600, fontSize: '0.75rem', marginBottom: '0.35rem' }}>Recent runs</div>
                {toolLog.map((entry, i) => (
                  <div key={i} style={{ fontSize: '0.7rem', fontFamily: 'monospace', marginBottom: '0.25rem' }}>
                    {entry.tool} @ {entry.at.slice(11, 19)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        </div>
      )}

      {mode === 'granular' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p style={{ fontSize: '0.85rem', color: 'var(--fg-muted)' }}>
            Run each tool in order. IDs from each step fill the context bar above.
          </p>
          <div className="form-group">
            <label className="form-label">Connected account *</label>
            <select
              className="form-input"
              value={values.account_id ?? ''}
              onChange={(e) => setField('account_id', e.target.value)}
            >
              <option value="">Select…</option>
              {adAccounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>{a.ad_account_name || a.account_name}</option>
              ))}
            </select>
          </div>
          {granularPipeline.map((toolId) => {
            const t = GOOGLE_TOOLS.find((x) => x.toolId === toolId)
            if (!t) return null
            return (
              <GoogleAdsToolRunner
                key={toolId}
                tool={t}
                context={toolContext}
                onResult={handleToolResult}
                onToast={onToast}
              />
            )
          })}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onCancel}>Close</button>
            <button type="button" className="btn btn-primary" onClick={() => finishCreate(false)} disabled={saving}>
              Save draft from context
            </button>
          </div>
        </div>
      )}

      {mode === 'guided' && (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.5rem' }}>
              Step {stepIndex + 1} of {steps.length}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {steps.map((s, i) => (
                <div
                  key={s.id}
                  title={s.title}
                  style={{
                    flex: 1,
                    height: 4,
                    borderRadius: 2,
                    background: i <= stepIndex ? '#4285f4' : 'var(--border)',
                  }}
                />
              ))}
            </div>
          </div>

          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}

          <div className="card" style={{ padding: '1.25rem', marginBottom: '1rem' }}>
            <h3 style={{ margin: '0 0 0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Layers size={18} /> {step?.title}
            </h3>
            {step?.description && (
              <p style={{ color: 'var(--fg-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>{step.description}</p>
            )}
            {!googleStepValidation.ok && step?.id !== 'review' && (
              <p style={{ color: 'var(--warning)', fontSize: '0.8rem' }}>{googleStepValidation.errors[0]}</p>
            )}
            {renderGuidedStep()}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={stepIndex === 0 ? onCancel : () => setStepIndex((i) => i - 1)}>
              <ChevronLeft size={14} /> {stepIndex === 0 ? 'Cancel' : 'Back'}
            </button>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {step?.id === 'review' ? (
                <>
                  <button type="button" className="btn btn-secondary" disabled={saving} onClick={() => finishCreate(false)}>
                    Save draft
                  </button>
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={() => finishCreate(true)}>
                    Create &amp; publish
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!validateStep()}
                  onClick={() => (isLast ? setStepIndex(stepIndex) : setStepIndex((i) => i + 1))}
                >
                  {isLast ? 'Review' : <>Next <ChevronRight size={14} /></>}
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                title="Open tool console"
                onClick={() => setField('wizard_mode', 'tools')}
              >
                <Wrench size={14} /> Tools
              </button>
            </div>
          </div>
        </>
      )}

      {mode === 'tools' && (
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>Close</button>
          <button type="button" className="btn btn-ghost" onClick={() => setField('wizard_mode', 'guided')}>
            Back to guided wizard
          </button>
        </div>
      )}
    </div>
  )
}
