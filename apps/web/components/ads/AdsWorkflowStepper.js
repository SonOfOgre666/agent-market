'use client'

import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api.js'
import { useConfirmDialog } from '../../lib/useConfirmDialog.js'
import {
  buildGoogleCampaignPayload,
  normalizeGoogleFormValues,
  validateGoogleWorkflowStep,
} from '../../lib/googleAdsWorkflow.js'
import { buildGeoTargeting, fetchMetaAdAccountProfile, listMetaAdAccounts } from '../../lib/metaAdsTools.js'
import GoogleAdCreativeFields from './GoogleAdCreativeFields.js'
import GoogleRsaPublishChecklist from './GoogleRsaPublishChecklist.js'
import { googleRsaDraft, validateGoogleRsaForPublish } from '../../lib/googleRsaValidation.js'
import GoogleAdGroupFields from './GoogleAdGroupFields.js'
import GoogleKeywordFields from './GoogleKeywordFields.js'
import GoogleReviewSummary from './GoogleReviewSummary.js'
import GoogleTargetingFields from './GoogleTargetingFields.js'
import {
  billingOptionsForGoal,
  formatMetaReviewValue,
  resolveBillingEventForGoal,
} from '../../lib/metaAdsetDelivery.js'
import MetaTargetingFields from './MetaTargetingFields.js'
import MetaAdCreativeFields from './MetaAdCreativeFields.js'
import {
  engagementDestinationType,
  goalRequiresAppStore,
  goalRequiresLeadForm,
  goalRequiresPixel,
  goalRequiresVideo,
  isEngagementObjective,
  objectiveSupportsWebsiteDestination,
  optimizationGoalHint,
  validateMetaPublishConfiguration,
} from '../../lib/metaCreativeRequirements.js'

function defaultValue(field) {
  if (field.type === 'select' && field.options?.length) return field.options[0].value
  return ''
}

/** Must match reference_ads/meta_ads/adsets.py × campaign objective (publish_defaults normalizes too). */
const META_OPTIMIZATION_BY_OBJECTIVE = {
  OUTCOME_TRAFFIC: [
    { value: 'LINK_CLICKS', label: 'Link clicks' },
    { value: 'LANDING_PAGE_VIEWS', label: 'Landing page views' },
    { value: 'IMPRESSIONS', label: 'Impressions' },
    { value: 'REACH', label: 'Reach' },
  ],
  OUTCOME_AWARENESS: [
    { value: 'REACH', label: 'Reach' },
    { value: 'THRUPLAY', label: 'ThruPlay (video required)' },
  ],
  // Meta ODAX: ON_POST / ON_VIDEO — not WEBSITE. IMPRESSIONS goal removed (Graph subcode 3858327).
  OUTCOME_ENGAGEMENT: [
    { value: 'POST_ENGAGEMENT', label: 'Post engagement' },
    { value: 'REACH', label: 'Reach' },
    { value: 'THRUPLAY', label: 'ThruPlay (video required)' },
  ],
  OUTCOME_LEADS: [
    { value: 'LEAD_GENERATION', label: 'Lead generation (instant form)' },
    { value: 'LINK_CLICKS', label: 'Link clicks (website)' },
    { value: 'QUALITY_LEAD', label: 'Quality lead (instant form)' },
  ],
  // Meta rejects LINK_CLICKS on OUTCOME_SALES (subcode 2490408) — use Traffic for link clicks.
  OUTCOME_SALES: [
    { value: 'OFFSITE_CONVERSIONS', label: 'Conversions (requires Pixel)' },
    { value: 'VALUE', label: 'Conversion value (requires Pixel)' },
  ],
  OUTCOME_APP_PROMOTION: [
    { value: 'APP_INSTALLS', label: 'App installs' },
    { value: 'VALUE', label: 'Value' },
  ],
}

export default function AdsWorkflowStepper({ platform, onCancel, onComplete, onToast }) {
  const { confirm, ConfirmDialogHost } = useConfirmDialog()
  const [schema, setSchema] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [values, setValues] = useState({})
  const [adAccounts, setAdAccounts] = useState([])
  const [metaAdAccountOptions, setMetaAdAccountOptions] = useState([])
  const [facebookPageOptions, setFacebookPageOptions] = useState([])
  const [pixelOptions, setPixelOptions] = useState([])
  const [pixelLoading, setPixelLoading] = useState(false)
  const [pixelError, setPixelError] = useState(null)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState(null)
  const [saving, setSaving] = useState(false)

  const [metaAdAccountProfile, setMetaAdAccountProfile] = useState(null)
  const [metaAccountProfileError, setMetaAccountProfileError] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const [sch, accts] = await Promise.all([
          api.adsWorkflowSchema(platform),
          api.adAccounts(),
        ])
        if (cancelled) return
        setSchema(sch)
        const initial = {}
        for (const st of sch?.steps || []) {
          for (const field of st.fields || []) {
            initial[field.name] = defaultValue(field)
          }
        }
        setValues(initial)
        setAdAccounts((accts?.items || []).filter(a => a.provider === platform))
      } catch (e) {
        if (!cancelled) setError(e.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [platform])

  const selectedConnectAccount = adAccounts.find(a => a.account_id === values.account_id)

  useEffect(() => {
    if (platform !== 'meta_ads' || !values.objective) return
    const opts = META_OPTIMIZATION_BY_OBJECTIVE[values.objective] || META_OPTIMIZATION_BY_OBJECTIVE.OUTCOME_TRAFFIC
    if (values.optimization_goal && !opts.some((o) => o.value === values.optimization_goal)) {
      setValues((v) => ({ ...v, optimization_goal: opts[0].value }))
    }
  }, [platform, values.objective, values.optimization_goal])

  useEffect(() => {
    if (platform !== 'meta_ads' || !values.optimization_goal) return
    const allowed = billingOptionsForGoal(values.optimization_goal).map((o) => o.value)
    if (!allowed.includes(values.billing_event)) {
      setValues((v) => ({
        ...v,
        billing_event: resolveBillingEventForGoal(values.optimization_goal, v.billing_event),
      }))
    }
  }, [platform, values.optimization_goal, values.billing_event])

  useEffect(() => {
    if (platform !== 'meta_ads' || !values.account_id) {
      setMetaAdAccountOptions([])
      setFacebookPageOptions([])
      setMetaAdAccountProfile(null)
      setMetaAccountProfileError(null)
      return
    }
    let cancelled = false
    setPickerLoading(true)
    setPickerError(null)
    const conn = adAccounts.find(a => a.account_id === values.account_id)
    ;(async () => {
      try {
        let pages = []
        const { accounts, fetchError } = await listMetaAdAccounts(values.account_id, conn)
        let accountsList = accounts
        const actForPages = values.ad_account_id || conn?.ad_account_id
        if (actForPages) {
          try {
            pages = await api.metaAccountPages(values.account_id, actForPages)
          } catch {
            pages = []
          }
        }
        if (cancelled) return
        setMetaAdAccountOptions(accountsList)
        setFacebookPageOptions(Array.isArray(pages) ? pages : [])
        setPickerError(
          fetchError && !accountsList.length
            ? fetchError
            : (!accountsList.length ? 'No ad accounts returned from Meta. Reconnect under Accounts.' : null),
        )

        setValues(v => {
          const next = { ...v }
          const storedAct = conn?.ad_account_id
          if (!next.ad_account_id) {
            const match = storedAct
              ? accountsList.find(a => a.id === storedAct || a.id === `act_${String(storedAct).replace(/^act_/, '')}`)
              : null
            next.ad_account_id = match?.id || accountsList[0]?.id || storedAct || ''
          }
          return next
        })
      } finally {
        if (!cancelled) setPickerLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [platform, values.account_id, values.ad_account_id, selectedConnectAccount?.ad_account_id, adAccounts])

  /** Graph ad account row (timezone, DSA) — same tool as agent: ``meta_get_account``. */
  useEffect(() => {
    if (platform !== 'meta_ads' || !values.account_id || !values.ad_account_id) {
      setMetaAdAccountProfile(null)
      setMetaAccountProfileError(null)
      setProfileLoading(false)
      return
    }
    let cancelled = false
    setProfileLoading(true)
    setMetaAccountProfileError(null)
    ;(async () => {
      try {
        const { profile, error } = await fetchMetaAdAccountProfile(values.account_id, values.ad_account_id)
        if (!cancelled) {
          setMetaAdAccountProfile(profile)
          setMetaAccountProfileError(error)
        }
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [platform, values.account_id, values.ad_account_id])

  useEffect(() => {
    if (platform !== 'meta_ads' || !values.account_id || !values.ad_account_id) return
    let cancelled = false
    ;(async () => {
      try {
        const pages = await api.metaAccountPages(values.account_id, values.ad_account_id)
        if (!cancelled) setFacebookPageOptions(Array.isArray(pages) ? pages : [])
      } catch {
        if (!cancelled) setFacebookPageOptions([])
      }
    })()
    return () => { cancelled = true }
  }, [platform, values.account_id, values.ad_account_id])

  /** Sales conversion ad sets — meta_list_ad_pixels (§4.3); auto-select when one pixel. */
  useEffect(() => {
    if (platform !== 'meta_ads' || !values.account_id || !values.ad_account_id) {
      setPixelOptions([])
      setPixelError(null)
      return
    }
    if (values.objective !== 'OUTCOME_SALES') {
      setPixelOptions([])
      setPixelError(null)
      return
    }
    let cancelled = false
    setPixelLoading(true)
    setPixelError(null)
    ;(async () => {
      try {
        const res = await api.metaPixels(values.account_id, values.ad_account_id)
        if (cancelled) return
        const pixels = (res.pixels || []).filter((p) => !p.is_unavailable)
        setPixelOptions(pixels)
        const defaultId =
          res.default_pixel_id
          || (pixels.length === 1 ? String(pixels[0].pixel_id || pixels[0].id || '') : null)
        if (defaultId) {
          setValues((v) => {
            const current = String(v.pixel_id || '').trim()
            if (current && pixels.some((p) => String(p.pixel_id || p.id) === current)) {
              return v
            }
            return { ...v, pixel_id: String(defaultId) }
          })
        }
      } catch (e) {
        if (!cancelled) {
          setPixelError(e.message || 'Failed to load pixels')
          setPixelOptions([])
        }
      } finally {
        if (!cancelled) setPixelLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [platform, values.account_id, values.ad_account_id, values.objective])

  const steps = schema?.steps || []
  const step = steps[stepIndex]
  const isLast = stepIndex >= steps.length - 1

  const reviewSummary = useMemo(
    () => Object.entries(values).filter(([, v]) => v !== '' && v != null),
    [values],
  )

  const googleStepValidation = useMemo(() => {
    if (platform !== 'google_ads' || !step?.id || step.id === 'review') return { ok: true, errors: [] }
    return validateGoogleWorkflowStep(step.id, values)
  }, [platform, step?.id, values])

  const setField = (name, value) => setValues(v => ({ ...v, [name]: value }))

  const validateStep = () => {
    if (!step || step.id === 'review') return true
    const needsVideo = platform === 'meta_ads' && goalRequiresVideo(values.optimization_goal)
    for (const field of step.fields || []) {
      if (!field.required) continue
      if (step.id === 'ads' && needsVideo && (field.name === 'link_url' || field.name === 'image_url')) {
        continue
      }
      if (step.id === 'ads' && !needsVideo && field.name === 'image_url') {
        continue
      }
      const val =
        field.type === 'ad_account' ? values.account_id : values[field.name]
      if (val === '' || val == null) return false
    }
    if (step.id === 'ads' && platform === 'meta_ads') {
      if (needsVideo) {
        if (!(values.video_id || values.video_url)) return false
      } else if (!(values.image_hash || values.image_url)) {
        return false
      }
      if (goalRequiresLeadForm(values.optimization_goal) && !(values.lead_gen_form_id || '').trim()) {
        return false
      }
    }
    if (platform === 'meta_ads' && step.id === 'adset') {
      if (goalRequiresPixel(values.objective, values.optimization_goal) && !(values.pixel_id || '').trim()) {
        return false
      }
      if (goalRequiresAppStore(values.objective)) {
        if (!(values.application_id || '').trim() || !(values.object_store_url || '').trim()) return false
      }
    }
    if (platform === 'google_ads' && step?.id) {
      if (!googleStepValidation.ok) return false
    }
    return true
  }

  const googlePublishReady =
    platform !== 'google_ads'
    || validateGoogleRsaForPublish(normalizeGoogleFormValues(values)).ok

  const buildCampaignPayload = () => {
    if (platform === 'google_ads') {
      return buildGoogleCampaignPayload(values)
    }

    const keywords = (values.keywords || '')
      .split(/[\n,]/)
      .map(k => k.trim())
      .filter(Boolean)

    const selected = adAccounts.find(a => a.account_id === values.account_id)

    const hasLink = Boolean((values.link_url || '').trim())
    const needsVideoGoal = goalRequiresVideo(values.optimization_goal)
    const hasVideoMedia = Boolean(values.video_id || values.video_url)
    const needsLeadForm = goalRequiresLeadForm(values.optimization_goal)
    const needsApp = goalRequiresAppStore(values.objective)
    const engagementDest = isEngagementObjective(values.objective)
      ? engagementDestinationType(values.optimization_goal, needsVideoGoal || hasVideoMedia)
      : null
    const useWebsiteDest =
      hasLink
      && !needsVideoGoal
      && !needsLeadForm
      && !needsApp
      && objectiveSupportsWebsiteDestination(values.objective)
    const targeting = platform === 'meta_ads'
      ? {
          adset_name: values.adset_name || `${values.name || 'Campaign'} — Ad Set`,
          optimization_goal: values.optimization_goal || 'LINK_CLICKS',
          billing_event: resolveBillingEventForGoal(
            values.optimization_goal || 'LINK_CLICKS',
            values.billing_event,
          ),
          ...(values.pixel_id ? { pixel_id: String(values.pixel_id).trim() } : {}),
          ...(values.custom_event_type
            ? { custom_event_type: String(values.custom_event_type).trim().toUpperCase() }
            : {}),
          ...(values.application_id ? { application_id: String(values.application_id).trim() } : {}),
          ...(values.object_store_url
            ? { object_store_url: String(values.object_store_url).trim() }
            : {}),
          ...(engagementDest
            ? { destination_type: engagementDest }
            : needsLeadForm
              ? { destination_type: 'ON_AD' }
              : needsApp
                ? { destination_type: 'APP' }
                : useWebsiteDest
                  ? { destination_type: 'WEBSITE' }
                  : {}),
          ...buildGeoTargeting(
            values.target_countries,
            (values.meta_interests || []).length
              ? [{ interests: (values.meta_interests || []).map((i) => ({ id: i.id, name: i.name })) }]
              : null,
          ),
        }
        : {}

    const headlines = (values.headlines || '')
      .split('\n')
      .map(h => h.trim())
      .filter(Boolean)
    const descriptions = (values.descriptions || '')
      .split('\n')
      .map(d => d.trim())
      .filter(Boolean)

    return {
      name: values.name,
      platform,
      type: values.type || 'social',
      account_id: values.account_id || null,
      ad_account_id: values.ad_account_id || selected?.ad_account_id || null,
      objective: values.objective || null,
      budget: {
        amount: parseFloat(values.budget_amount || values.daily_budget) || 0,
        currency: values.budget_currency || 'USD',
        type: 'daily',
      },
      start_date: values.start_date || null,
      end_date: values.end_date || null,
      keywords,
      targeting,
      pixel_id: (values.pixel_id || '').trim() || null,
      custom_event_type: (values.custom_event_type || '').trim() || null,
      application_id: (values.application_id || '').trim() || null,
      object_store_url: (values.object_store_url || '').trim() || null,
      lead_gen_form_id: (values.lead_gen_form_id || '').trim() || null,
      creatives: {
        link_url: values.link_url || '',
        path1: (values.path1 || '').trim() || null,
        path2: (values.path2 || '').trim() || null,
        page_id: values.page_id || null,
        image_url: values.image_url || null,
        image_hash: values.image_hash || null,
        video_url: values.video_url || null,
        video_id: values.video_id || null,
        message: (values.primary_text || '').trim() || null,
        headlines: headlines.length ? headlines : (values.headlines ? [values.headlines] : []),
        descriptions: descriptions.length ? descriptions : (values.descriptions ? [values.descriptions] : []),
        lead_gen_form_id: (values.lead_gen_form_id || '').trim() || null,
        call_to_action_type: needsLeadForm ? 'SIGN_UP' : 'LEARN_MORE',
      },
    }
  }

  const validateBeforeCreate = () => {
    if (!(values.name || '').trim()) {
      setError('Campaign name is required')
      return false
    }
    if (!values.account_id) {
      setError(
        platform === 'google_ads'
          ? 'Select a connected Google Ads account'
          : 'Select a connected Meta Ads account',
      )
      return false
    }
    if (platform === 'google_ads') {
      const budget = parseFloat(values.budget_amount)
      if (!Number.isFinite(budget) || budget < 1) {
        setError('Daily budget must be at least $1')
        return false
      }
    }
    if (platform === 'meta_ads' && !(values.ad_account_id || '').trim()) {
      setError('Select a Meta ad account')
      return false
    }
    if (platform === 'meta_ads') {
      if (!(values.adset_name || '').trim()) {
        setError('Ad set name is required')
        return false
      }
      const budget = parseFloat(values.daily_budget)
      if (!Number.isFinite(budget) || budget < 1) {
        setError('Daily budget must be at least $1')
        return false
      }
      if (!values.objective) {
        setError('Campaign objective is required')
        return false
      }
    }
    return true
  }

  const validateBeforePublish = () => {
    if (platform === 'google_ads') {
      const { ok, errors } = validateGoogleRsaForPublish(normalizeGoogleFormValues(values))
      if (!ok) {
        setError(errors[0] || 'Complete RSA fields on the Ads step (final_url, headlines, descriptions)')
        return false
      }
      if ((values.type || 'search') !== 'search') {
        setError('Only type=search is supported for publish in this wizard')
        return false
      }
      return true
    }
    if (platform !== 'meta_ads') return true
    const configErr = validateMetaPublishConfiguration(values)
    if (configErr) {
      setError(configErr)
      return false
    }
    if (!(values.page_id || '').trim()) {
      setError('Select a Facebook Page — required for meta_create_creative (meta_get_account_pages)')
      return false
    }
    const needsVideo = goalRequiresVideo(values.optimization_goal)
    if (needsVideo) {
      if (!(values.video_id || '').trim() && !(values.video_url || '').trim()) {
        setError('ThruPlay requires a video: add a public video URL and upload to Meta (meta_upload_ad_video)')
        return false
      }
    } else {
      if (!(values.link_url || '').trim()) {
        setError('Destination URL is required for image link ads')
        return false
      }
      if (!(values.image_hash || '').trim() && !(values.image_url || '').trim()) {
        setError(
          'Ad image is required: set a public image URL or upload via meta_upload_ad_image',
        )
        return false
      }
    }
    return true
  }

  const finishCreate = async (alsoPublish) => {
    if (!validateBeforeCreate()) return
    if (alsoPublish && !validateBeforePublish()) return
    setSaving(true)
    setError(null)
    try {
      const created = await api.createCampaign(buildCampaignPayload())
      if (!created?.id) {
        throw new Error('Server did not return a campaign id — check API logs and Mongo connection')
      }
      if (alsoPublish && (platform === 'meta_ads' || platform === 'google_ads')) {
        if (!created.account_id) throw new Error('Connected account is required to publish')
        await api.publishCampaign(created.id)
        onToast?.(
          platform === 'google_ads'
            ? 'Campaign saved and publish queued to Google Ads'
            : 'Campaign saved and publish queued to Meta',
        )
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

  const handleNext = async () => {
    if (!validateStep()) return
    if (!isLast) {
      setStepIndex(i => i + 1)
      return
    }
    await finishCreate(false)
  }

  const handleCreateAndPublish = async () => {
    if (!validateStep()) return
    if (!values.account_id) {
      setError(
        platform === 'google_ads'
          ? 'Select a connected Google Ads account before publishing'
          : 'Select a connected Meta Ads account before publishing',
      )
      return
    }
    const message =
      platform === 'google_ads'
        ? 'Create this campaign on Google Ads (paused)? Location targeting and negatives apply after the campaign is created.'
        : 'Create this campaign on Meta Ads (paused)? This uses your live ad account.'
    const ok = await confirm({
      title: 'Create and publish?',
      message,
      confirmLabel: platform === 'google_ads' ? 'Publish to Google' : 'Publish to Meta',
      variant: 'primary',
    })
    if (!ok) return
    await finishCreate(true)
  }

  const renderField = (field) => {
    const val = values[field.name] ?? ''
    if (field.type === 'ad_account') {
      return (
        <select
          className="form-input"
          value={values.account_id ?? ''}
          onChange={e => {
            setField('account_id', e.target.value)
            if (platform === 'meta_ads') {
              setField('ad_account_id', '')
              setField('page_id', '')
            }
          }}
          required={field.required}
        >
          <option value="">Select account…</option>
          {adAccounts.map(a => (
            <option key={a.account_id} value={a.account_id}>
              {a.ad_account_name || a.account_name}
            </option>
          ))}
        </select>
      )
    }
    if (field.type === 'meta_ad_account') {
      if (!values.account_id) {
        return <p style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', margin: 0 }}>Select a connected account first.</p>
      }
      return (
        <>
          <select
            className="form-input"
            value={values.ad_account_id ?? ''}
            onChange={e => setField('ad_account_id', e.target.value)}
            required={field.required}
            disabled={pickerLoading}
          >
            <option value="">{pickerLoading ? 'Loading ad accounts (meta_get_ad_accounts)…' : 'Select ad account…'}</option>
            {metaAdAccountOptions.map(a => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}{a.currency ? ` (${a.currency})` : ''}{a.status_label ? ` — ${a.status_label}` : ''}
              </option>
            ))}
          </select>
          {pickerError && (
            <p style={{ fontSize: '0.75rem', color: 'var(--danger)', marginTop: '0.35rem' }}>{pickerError}</p>
          )}
          {!pickerLoading && metaAdAccountOptions.length > 0 && (
            <p style={{ fontSize: '0.7rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
              {metaAdAccountOptions.length} ad account{metaAdAccountOptions.length === 1 ? '' : 's'} from Meta (meta_get_ad_accounts).
            </p>
          )}
          {!pickerLoading && !pickerError && metaAdAccountOptions.length === 0 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
              No ad accounts returned. Reconnect Meta Ads under Accounts and pick an ad account.
            </p>
          )}
          {profileLoading && (
            <p style={{ fontSize: '0.72rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>Loading account details (meta_get_account)…</p>
          )}
          {!profileLoading && metaAccountProfileError && values.ad_account_id && (
            <p style={{ fontSize: '0.72rem', color: 'var(--danger)', marginTop: '0.35rem' }}>{metaAccountProfileError}</p>
          )}
          {!profileLoading && !metaAccountProfileError && metaAdAccountProfile && (
            <div
              style={{
                fontSize: '0.72rem',
                color: 'var(--fg-muted)',
                marginTop: '0.5rem',
                padding: '0.45rem 0.55rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-subtle, rgba(0,0,0,0.03))',
              }}
            >
              <strong style={{ color: 'var(--fg)' }}>Ad account (meta_get_account)</strong>
              {metaAdAccountProfile.name ? ` · ${metaAdAccountProfile.name}` : ''}
              {metaAdAccountProfile.timezone_name ? ` · ${metaAdAccountProfile.timezone_name}` : ''}
              {metaAdAccountProfile.currency ? ` · ${metaAdAccountProfile.currency}` : ''}
              {metaAdAccountProfile.account_status != null ? ` · status ${metaAdAccountProfile.account_status}` : ''}
              {metaAdAccountProfile.dsa_required ? (
                <p style={{ margin: '0.35rem 0 0', color: 'var(--fg)' }}>
                  {metaAdAccountProfile.dsa_compliance_note || 'European DSA requirements may apply.'}
                </p>
              ) : (
                <p style={{ margin: '0.35rem 0 0', color: 'var(--fg-muted)' }}>
                  {metaAdAccountProfile.dsa_compliance_note || 'DSA: not flagged for EU business country on this account.'}
                </p>
              )}
            </div>
          )}
        </>
      )
    }
    if (field.type === 'facebook_page') {
      if (!values.account_id) {
        return <p style={{ fontSize: '0.8rem', color: 'var(--fg-muted)', margin: 0 }}>Select a connected account first.</p>
      }
      return (
        <>
          <select
            className="form-input"
            value={values.page_id ?? ''}
            onChange={e => setField('page_id', e.target.value)}
            required={field.required}
            disabled={pickerLoading}
          >
            <option value="">{pickerLoading ? 'Loading pages…' : 'Select Facebook Page (meta_get_account_pages)…'}</option>
            {facebookPageOptions.map(p => (
              <option key={p.id} value={p.id}>
                {p.name || p.id}
              </option>
            ))}
          </select>
          {!pickerLoading && facebookPageOptions.length === 0 && (
            <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
              No Pages found for this token. Ensure Meta OAuth includes pages access, or connect a Facebook Page under Accounts.
            </p>
          )}
        </>
      )
    }
    if (platform === 'meta_ads' && field.name === 'billing_event') {
      const billOpts = billingOptionsForGoal(values.optimization_goal)
      if (billOpts.length === 1) {
        return (
          <>
            <input className="form-input" readOnly value={billOpts[0].value} aria-readonly />
            <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
              Impressions billing for <strong>{values.optimization_goal || '…'}</strong> (Meta Ads Manager).
            </p>
          </>
        )
      }
      return (
        <>
          <select
            className="form-input"
            value={resolveBillingEventForGoal(values.optimization_goal, val)}
            onChange={(e) => setField(field.name, e.target.value)}
            required={field.required}
          >
            {billOpts.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
            Link clicks goal: charge per impression or per link click (same as Meta Ads Manager).
          </p>
        </>
      )
    }
    if (field.type === 'select') {
      const options =
        platform === 'meta_ads' && field.name === 'optimization_goal'
          ? (META_OPTIMIZATION_BY_OBJECTIVE[values.objective] || META_OPTIMIZATION_BY_OBJECTIVE.OUTCOME_TRAFFIC)
          : (field.options || [])
      const goalHint =
        platform === 'meta_ads' && field.name === 'optimization_goal'
          ? optimizationGoalHint(values.optimization_goal, values.objective)
          : null
      return (
        <>
          <select
            className="form-input"
            value={val}
            onChange={e => setField(field.name, e.target.value)}
            required={field.required}
          >
            {options.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          {goalHint && (
            <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>{goalHint}</p>
          )}
        </>
      )
    }
    if (field.type === 'textarea') {
      return (
        <textarea
          className="form-input"
          rows={3}
          value={val}
          onChange={e => setField(field.name, e.target.value)}
          required={field.required}
        />
      )
    }
    if (field.type === 'number') {
      return (
        <input
          className="form-input"
          type="number"
          min={field.min}
          value={val}
          onChange={e => setField(field.name, e.target.value)}
          required={field.required}
        />
      )
    }
    if (field.type === 'date') {
      return (
        <input
          className="form-input"
          type="date"
          value={val}
          onChange={e => setField(field.name, e.target.value)}
          required={field.required}
        />
      )
    }
    return (
      <input
        className="form-input"
        type={field.type === 'url' ? 'url' : 'text'}
        value={val}
        onChange={e => setField(field.name, e.target.value)}
        required={field.required}
        placeholder={field.label}
      />
    )
  }

  if (loading) {
    return <div className="skeleton" style={{ height: 200 }} />
  }

  if (error && !schema) {
    return <p style={{ color: 'var(--danger)' }}>{error}</p>
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginBottom: '0.5rem' }}>
          Step {stepIndex + 1} of {steps.length} — {schema?.label}
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {steps.map((s, i) => (
            <div
              key={s.id}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                background: i <= stepIndex ? 'var(--accent)' : 'var(--border)',
              }}
            />
          ))}
        </div>
      </div>

      {step?.id === 'review' ? (
        <div style={{ fontSize: '0.875rem', color: 'var(--fg-muted)', marginBottom: '1rem' }}>
          <p style={{ marginBottom: '0.75rem' }}>
            {step.description
              || (platform === 'google_ads'
                ? 'Save draft stores the campaign here only. Use Create & publish to Google to push via ads tools (ai-worker must be running). Search campaigns do not send start/end dates to Google (draft only). Geo and negative keywords run after the campaign is created.'
                : 'Save draft stores the campaign here only. Use Create & publish to Meta to push via ads tools (ai-worker must be running).')}
          </p>
          {platform === 'google_ads' && (
            <>
              <GoogleRsaPublishChecklist values={values} />
              <p
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--fg-muted)',
                  marginBottom: '0.75rem',
                  padding: '0.65rem 0.75rem',
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg-subtle, rgba(0,0,0,0.03))',
                }}
              >
                Publish uses <code>google_publish_campaign</code> (same chain as <code>google_create_campaign</code>), then{' '}
                <code>google_create_geo_targeting</code> / <code>google_exclude_geo_targets</code> /{' '}
                <code>google_add_negative_keywords</code> when configured in the targeting step.
              </p>
            </>
          )}
          {platform === 'meta_ads' && (
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--fg-muted)',
                marginBottom: '0.75rem',
                padding: '0.65rem 0.75rem',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: 'var(--bg-subtle, rgba(0,0,0,0.03))',
              }}
            >
              <strong>Meta app must be Live</strong> to create ads. If publish fails with error 1885183,
              switch your Facebook app to Live in{' '}
              <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer">
                Meta for Developers
              </a>
              , complete App Review for <code>ads_management</code> (and <code>pages_show_list</code> if using Pages),
              then reconnect Meta Ads under Accounts.
            </p>
          )}
          {platform === 'google_ads' ? (
            <GoogleReviewSummary values={values} />
          ) : (
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {reviewSummary.map(([k, v]) => (
                <li key={k}><strong>{k}</strong>: {formatMetaReviewValue(v)}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div>
          <h3 style={{ margin: '0 0 0.25rem' }}>{step?.title}</h3>
          {step?.description && (
            <p style={{ color: 'var(--fg-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>{step.description}</p>
          )}
          {platform === 'google_ads' && step?.id === 'goal' && values.type && values.type !== 'search' && (
            <p
              style={{
                fontSize: '0.8rem',
                color: 'var(--warning, #b45309)',
                marginBottom: '1rem',
                padding: '0.65rem 0.75rem',
                borderRadius: 6,
                border: '1px solid var(--warning, #f59e0b)',
              }}
            >
              Publish supports <code>type=search</code> only. Select Search for full{' '}
              <code>google_publish_campaign</code> (RSA + keyword_entries).
            </p>
          )}
          {platform === 'google_ads' && !googleStepValidation.ok && googleStepValidation.errors.length > 0 && (
            <p style={{ color: 'var(--danger, #dc2626)', fontSize: '0.8rem', marginBottom: '1rem' }}>
              {googleStepValidation.errors[0]}
            </p>
          )}
          {platform === 'meta_ads' && step?.id === 'targeting' ? (
            <MetaTargetingFields
              accountId={values.account_id}
              adAccountId={values.ad_account_id}
              values={values}
              setField={setField}
              optimizationGoal={values.optimization_goal}
            />
          ) : platform === 'google_ads' && step?.id === 'targeting' ? (
            <GoogleTargetingFields values={values} setField={setField} />
          ) : platform === 'google_ads' && step?.id === 'adgroup' ? (
            <>
              <GoogleAdGroupFields values={values} setField={setField} />
              <GoogleKeywordFields values={values} setField={setField} />
            </>
          ) : platform === 'google_ads' && step?.id === 'ads' ? (
            <>
              {(step?.fields || []).map((field) => {
                const rsa = googleRsaDraft(normalizeGoogleFormValues(values))
                const hint =
                  field.name === 'headlines'
                    ? `${rsa.headlines.length}/3–15 headlines (one per line, max 30 chars)`
                    : field.name === 'descriptions'
                      ? `${rsa.descriptions.length}/2–4 descriptions (one per line, max 90 chars)`
                      : field.name === 'final_url'
                        ? 'creatives.final_url — landing page for RSA'
                        : null
                return (
                  <div key={field.name} className="form-group">
                    <label className="form-label">
                      {field.label}{field.required ? ' *' : ''}
                    </label>
                    {field.name === 'headlines' || field.name === 'descriptions' ? (
                      <textarea
                        className="form-input"
                        rows={field.name === 'headlines' ? 5 : 3}
                        value={values[field.name] ?? ''}
                        onChange={(e) => setField(field.name, e.target.value)}
                        placeholder={
                          field.name === 'headlines'
                            ? 'Headline one\nHeadline two\nHeadline three'
                            : 'Description one\nDescription two'
                        }
                        required
                      />
                    ) : (
                      renderField(field)
                    )}
                    {hint && (
                      <p
                        style={{
                          fontSize: '0.75rem',
                          marginTop: '0.35rem',
                          color:
                            (field.name === 'headlines' && rsa.headlines.length < 3)
                            || (field.name === 'descriptions' && rsa.descriptions.length < 2)
                              ? 'var(--warning, #b45309)'
                              : 'var(--fg-muted)',
                        }}
                      >
                        {hint}
                        {field.name === 'headlines' && rsa.headlines.length < 3
                          ? ' — required for publish'
                          : ''}
                      </p>
                    )}
                  </div>
                )
              })}
              <GoogleAdCreativeFields values={values} setField={setField} />
            </>
          ) : platform === 'meta_ads' && step?.id === 'ads' ? (
            <>
              {(step?.fields || []).map((field) => {
                if (['image_url', 'primary_text'].includes(field.name)) return null
                return (
                  <div key={field.name} className="form-group">
                    <label className="form-label">
                      {field.label}{field.required ? ' *' : ''}
                    </label>
                    {renderField(field)}
                  </div>
                )
              })}
              <MetaAdCreativeFields
                accountId={values.account_id}
                adAccountId={values.ad_account_id}
                values={values}
                setField={setField}
                optimizationGoal={values.optimization_goal}
                onToast={(msg, type) => onToast?.(msg, type === 'error' ? 'error' : undefined)}
              />
              {goalRequiresLeadForm(values.optimization_goal) && (
                <div className="form-group">
                  <label className="form-label">Meta Instant Form ID *</label>
                  <input
                    className="form-input"
                    type="text"
                    value={values.lead_gen_form_id ?? ''}
                    onChange={e => setField('lead_gen_form_id', e.target.value)}
                    placeholder="e.g. 123456789012345 (digits only — not a URL)"
                    required
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
                    Numeric ID from Ads Manager → All tools → Instant forms. The Page must also accept{' '}
                    <a href="https://www.facebook.com/ads/leadgen/tos" target="_blank" rel="noreferrer">
                      Lead Generation Terms
                    </a>
                    {' '}(error 1815089 if not). Destination URL on the creative is still required separately.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              {(step?.fields || []).map(field => {
                if (
                  platform === 'meta_ads'
                  && step?.id === 'adset'
                  && ['pixel_id', 'custom_event_type'].includes(field.name)
                ) {
                  return null
                }
                return (
                  <div key={field.name} className="form-group">
                    <label className="form-label">
                      {field.label}{field.required ? ' *' : ''}
                    </label>
                    {renderField(field)}
                  </div>
                )
              })}
              {platform === 'meta_ads' && step?.id === 'adset' && goalRequiresPixel(values.objective, values.optimization_goal) && (
                <>
                  <div className="form-group">
                    <label className="form-label">Meta Pixel *</label>
                    {pixelLoading ? (
                      <p style={{ fontSize: '0.875rem', color: 'var(--fg-muted)' }}>Loading pixels…</p>
                    ) : pixelError ? (
                      <p style={{ fontSize: '0.875rem', color: 'var(--danger, #dc2626)' }}>{pixelError}</p>
                    ) : pixelOptions.length > 0 ? (
                      <select
                        className="form-input"
                        value={values.pixel_id ?? ''}
                        onChange={e => setField('pixel_id', e.target.value)}
                        required
                      >
                        <option value="">Select a pixel…</option>
                        {pixelOptions.map(p => {
                          const id = String(p.pixel_id || p.id || '')
                          return (
                            <option key={id} value={id}>
                              {(p.name || id) + (p.name ? ` (${id})` : '')}
                            </option>
                          )
                        })}
                      </select>
                    ) : (
                      <>
                        <p
                          style={{
                            fontSize: '0.875rem',
                            color: 'var(--warning, #b45309)',
                            marginBottom: '0.5rem',
                          }}
                        >
                          No pixels found on this ad account. Create one in{' '}
                          <a
                            href="https://business.facebook.com/events_manager"
                            target="_blank"
                            rel="noreferrer"
                          >
                            Meta Events Manager
                          </a>
                          {' '}or paste an existing pixel ID below.
                        </p>
                        <input
                          className="form-input"
                          type="text"
                          value={values.pixel_id ?? ''}
                          onChange={e => setField('pixel_id', e.target.value)}
                          placeholder="Pixel ID"
                          required
                        />
                      </>
                    )}
                    <p style={{ fontSize: '0.75rem', color: 'var(--fg-muted)', marginTop: '0.35rem' }}>
                      Required for Sales conversion ad sets (promoted_object.pixel_id). Listed via meta_list_ad_pixels.
                    </p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Conversion event</label>
                    <input
                      className="form-input"
                      type="text"
                      value={values.custom_event_type ?? 'PURCHASE'}
                      onChange={e => setField('custom_event_type', e.target.value)}
                      placeholder="PURCHASE"
                    />
                  </div>
                </>
              )}
              {platform === 'meta_ads' && step?.id === 'adset' && goalRequiresAppStore(values.objective) && (
                <>
                  <div className="form-group">
                    <label className="form-label">Facebook application ID *</label>
                    <input
                      className="form-input"
                      type="text"
                      value={values.application_id ?? ''}
                      onChange={e => setField('application_id', e.target.value)}
                      placeholder="App ID from developers.facebook.com"
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">App Store / Play Store URL *</label>
                    <input
                      className="form-input"
                      type="url"
                      value={values.object_store_url ?? ''}
                      onChange={e => setField('object_store_url', e.target.value)}
                      placeholder="https://apps.apple.com/... or https://play.google.com/..."
                      required
                    />
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        {stepIndex > 0 && (
          <button type="button" className="btn btn-secondary" onClick={() => setStepIndex(i => i - 1)}>
            Back
          </button>
        )}
        {isLast && (platform === 'meta_ads' || platform === 'google_ads') && (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={saving || !validateStep() || (platform === 'google_ads' && !googlePublishReady)}
            onClick={handleCreateAndPublish}
            title={
              platform === 'google_ads' && !googlePublishReady
                ? 'Add at least 3 headlines and 2 descriptions on the Ads step (one per line)'
                : undefined
            }
          >
            {saving ? (
              <span className="spinner" />
            ) : platform === 'google_ads' ? (
              'Create & publish to Google'
            ) : (
              'Create & publish to Meta'
            )}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || !validateStep()}
          onClick={handleNext}
        >
          {saving ? <span className="spinner" /> : isLast ? 'Save draft only' : 'Next'}
        </button>
      </div>
      <ConfirmDialogHost />
    </div>
  )
}
