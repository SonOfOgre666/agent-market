'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import AppLayout from '../../components/AppLayout.js'
import RequireWorkspaceAdmin from '../../components/RequireWorkspaceAdmin.js'
import { api } from '../../lib/api.js'
import { useToast } from '../../components/Toast.js'
import { useWorkspaceSettings } from '../../components/WorkspaceSettingsProvider.js'
import {
  modelsForFeature,
  modelLabel,
  providerOptionLabel,
  statusLabel,
  plannerModels,
} from '../../lib/aiCatalogUi.js'
import { Sparkles, AlertTriangle, CheckCircle2, XCircle, Circle, Activity } from 'lucide-react'

function formatTokens(n, executionType) {
  if (executionType === 'test') return '—'
  if (n == null) return '—'
  return n.toLocaleString()
}

function StatusBadge({ status }) {
  if (status === 'connected') {
    return (
      <span className="ai-status-badge ai-status-connected">
        <CheckCircle2 size={14} /> {statusLabel(status)}
      </span>
    )
  }
  if (status === 'invalid_key') {
    return (
      <span className="ai-status-badge ai-status-invalid">
        <XCircle size={14} /> {statusLabel(status)}
      </span>
    )
  }
  return (
    <span className="ai-status-badge ai-status-missing">
      <Circle size={14} /> {statusLabel(status)}
    </span>
  )
}

export default function AiSettingsPage() {
  const toast = useToast()
  const { formatDateTime } = useWorkspaceSettings()
  const [loading, setLoading] = useState(true)
  const [overview, setOverview] = useState(null)
  const [apiKeys, setApiKeys] = useState({})
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [features, setFeatures] = useState(null)
  const [planner, setPlanner] = useState(null)
  const [savingProvider, setSavingProvider] = useState({})
  const [testingProvider, setTestingProvider] = useState({})
  const [savingFeatures, setSavingFeatures] = useState(false)
  const [savingPlanner, setSavingPlanner] = useState(false)
  const [executions, setExecutions] = useState([])
  const [executionsLoading, setExecutionsLoading] = useState(true)

  const loadExecutions = useCallback(async () => {
    setExecutionsLoading(true)
    try {
      const data = await api.aiExecutions({ per_page: 50 })
      setExecutions(data.items || [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setExecutionsLoading(false)
    }
  }, [toast])

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.aiWorkspace()
      setOverview(data)
      setFeatures(data.features || {})
      setPlanner(data.planner || {})
      const ids = data.catalog?.provider_ids || []
      setApiKeys(Object.fromEntries(ids.map(id => [id, ''])))
      setOllamaUrl('')
      await loadExecutions()
    } catch (err) {
      toast.error(err.message)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [toast, loadExecutions])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial fetch only; save/test update state from API
  }, [])

  const configuredIds = useMemo(
    () => overview?.configured_provider_ids || [],
    [overview],
  )

  const catalog = overview?.catalog

  const providerOrder = useMemo(
    () => catalog?.provider_ids || [],
    [catalog],
  )

  const providerById = useMemo(() => {
    const map = {}
    for (const p of overview?.providers || []) map[p.id] = p
    return map
  }, [overview])

  const setFeature = (featureId, patch) => {
    setFeatures(prev => {
      const cur = prev[featureId] || {}
      const next = { ...cur, ...patch }
      if (patch.provider && patch.provider !== cur.provider) {
        const models = modelsForFeature(catalog, featureId, patch.provider)
        const ids = models.map(m => m.id)
        if (!ids.includes(next.model)) next.model = ids[0] || ''
      }
      return { ...prev, [featureId]: next }
    })
  }

  const setPlannerField = (patch) => {
    setPlanner(prev => {
      const next = { ...prev, ...patch }
      if (patch.provider && patch.provider !== prev?.provider) {
        const models = plannerModels(catalog, patch.provider)
        const ids = models.map(m => m.id)
        if (!ids.includes(next.model)) next.model = ids[0] || ''
      }
      return next
    })
  }

  const saveProvider = async (id) => {
    if (id === 'ollama') {
      const baseUrl = (ollamaUrl || '').trim()
      if (!baseUrl) {
        toast.error('Enter the Ollama server URL before saving')
        return
      }
      setSavingProvider(s => ({ ...s, [id]: true }))
      try {
        const data = await api.saveAiProvider(id, { base_url: baseUrl })
        setOverview(data)
        setFeatures(data.features || features)
        setPlanner(data.planner || planner)
        setOllamaUrl('')
        toast.success('Ollama saved')
      } catch (err) {
        toast.error(err.message)
      } finally {
        setSavingProvider(s => ({ ...s, [id]: false }))
      }
      return
    }

    const key = (apiKeys[id] || '').trim()
    if (!key) {
      toast.error('Enter an API key before saving')
      return
    }
    setSavingProvider(s => ({ ...s, [id]: true }))
    try {
      const data = await api.saveAiProvider(id, { api_key: key })
      setOverview(data)
      setFeatures(data.features || features)
      setPlanner(data.planner || planner)
      setApiKeys(k => ({ ...k, [id]: '' }))
      toast.success(`${catalog?.provider_labels?.[id] || id} saved`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingProvider(s => ({ ...s, [id]: false }))
    }
  }

  const testProvider = async (id) => {
    setTestingProvider(s => ({ ...s, [id]: true }))
    try {
      const body = id === 'ollama' && (ollamaUrl || '').trim()
        ? { base_url: ollamaUrl.trim() }
        : undefined
      const res = await api.testAiProvider(id, body)
      if (res.overview) {
        setOverview(res.overview)
        setFeatures(res.overview.features || features)
        setPlanner(res.overview.planner || planner)
      } else {
        await load({ silent: true })
      }
      const status = res.status || providerById[id]?.status
      if (status === 'connected') toast.success(`${catalog?.provider_labels?.[id] || id} connection OK`)
      else if (status === 'invalid_key') toast.error(`${catalog?.provider_labels?.[id] || id} key is invalid`)
      else if (id === 'ollama') toast.error('Save the Ollama server URL first, then test')
      else toast.error('Save an API key first, then test')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setTestingProvider(s => ({ ...s, [id]: false }))
    }
  }

  const saveFeatures = async () => {
    setSavingFeatures(true)
    try {
      const data = await api.saveAiFeatures(features)
      setOverview(data)
      setFeatures(data.features || features)
      toast.success('AI feature settings saved')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingFeatures(false)
    }
  }

  const savePlanner = async () => {
    setSavingPlanner(true)
    try {
      const data = await api.saveAiPlanner(planner)
      setOverview(data)
      setPlanner(data.planner || planner)
      toast.success('Marketing Assistant settings saved')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSavingPlanner(false)
    }
  }

  const warnings = overview?.warnings || []

  return (
    <RequireWorkspaceAdmin>
    <AppLayout>
      <div className="page-header-enhanced">
        <div className="page-header-content">
          <div className="page-header-title">
            <div className="page-header-icon">
              <Sparkles size={18} strokeWidth={2.5} />
            </div>
            <h1 className="page-title">AI Integrations</h1>
          </div>
          <p className="page-header-desc">
            Provider credentials, feature routing, and Marketing Assistant agent — stored per workspace.
          </p>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="ai-warnings-banner">
          <AlertTriangle size={18} />
          <div>
            <strong>Configuration warnings</strong>
            <ul>
              {warnings.map((w, i) => (
                <li key={`${w.feature_id}-${i}`}>{w.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-muted">Loading…</p>
      ) : (
        <>
          <section className="ai-settings-section">
            <h2 className="integrations-section-title">AI Providers</h2>
            <p className="text-muted integrations-section-desc">
              API keys are encrypted at rest. Ollama uses a local server URL. Test connection after saving to enable feature assignment.
            </p>
            <div className="integrations-section-grid ai-providers-grid">
              {providerOrder.map(id => {
                const meta = providerById[id] || { status: 'not_configured', has_key: false }
                const hasStoredKey = meta.has_key || overview?.credentials?.[id]?.has_key
                const isOllama = id === 'ollama'
                const canTest = isOllama
                  ? hasStoredKey || Boolean((ollamaUrl || '').trim())
                  : hasStoredKey
                return (
                  <div key={id} className="card">
                    <div className="ai-provider-card-head">
                      <div className="card-title">{catalog?.provider_labels?.[id] || id}</div>
                      <StatusBadge status={meta.status} />
                    </div>
                    {isOllama ? (
                      <>
                        <div className="form-group">
                          <label className="form-label">Server URL</label>
                          <input
                            className="form-input"
                            type="url"
                            placeholder={
                              hasStoredKey && meta.connection_hint
                                ? `${meta.connection_hint}  (saved — enter to replace)`
                                : 'http://localhost:11434'
                            }
                            value={ollamaUrl}
                            onChange={e => setOllamaUrl(e.target.value)}
                            autoComplete="off"
                          />
                        </div>
                        {hasStoredKey && meta.model_count > 0 && (
                          <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '-0.25rem' }}>
                            {meta.model_count} model{meta.model_count === 1 ? '' : 's'} loaded from server
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="form-group">
                        <label className="form-label">API Key</label>
                        <input
                          className="form-input"
                          type="password"
                          placeholder={hasStoredKey ? '••••••••  (saved — enter to replace)' : 'Paste API key'}
                          value={apiKeys[id] || ''}
                          onChange={e => setApiKeys(k => ({ ...k, [id]: e.target.value }))}
                          autoComplete="off"
                        />
                      </div>
                    )}
                    <div className="ai-provider-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={testingProvider[id] || !canTest}
                        onClick={() => testProvider(id)}
                      >
                        {testingProvider[id] ? <span className="spinner" /> : 'Test Connection'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={savingProvider[id]}
                        onClick={() => saveProvider(id)}
                      >
                        {savingProvider[id] ? <span className="spinner" /> : 'Save'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="ai-settings-section">
            <h2 className="integrations-section-title">AI Features</h2>
            <p className="text-muted integrations-section-desc">
              Choose which provider and model run each generation tool. Only connected providers can be selected.
            </p>
            <div className="card ai-features-card">
              {(catalog?.feature_ids || []).map(featureId => {
                const row = features?.[featureId] || {}
                const allowed = catalog?.providers_for_feature?.[featureId] || catalog?.provider_ids || []
                const models = modelsForFeature(catalog, featureId, row.provider)
                return (
                  <div key={featureId} className="ai-feature-row">
                    <div className="ai-feature-label">{catalog?.feature_labels?.[featureId] || featureId}</div>
                    <div className="ai-feature-fields">
                      <div className="form-group">
                        <label className="form-label">Provider</label>
                        <select
                          className="form-input"
                          value={row.provider || ''}
                          onChange={e => setFeature(featureId, { provider: e.target.value })}
                        >
                          {allowed.map(pid => {
                            const connected = configuredIds.includes(pid)
                            return (
                              <option key={pid} value={pid} disabled={!connected}>
                                {connected ? '✓ ' : '✗ '}
                                {providerOptionLabel(catalog, pid, configuredIds)}
                              </option>
                            )
                          })}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Model</label>
                        <select
                          className="form-input"
                          value={row.model || ''}
                          onChange={e => setFeature(featureId, { model: e.target.value })}
                          disabled={row.provider === 'ollama' && !models.length}
                        >
                          {row.provider === 'ollama' && !models.length ? (
                            <option value="">Test Ollama connection to load models</option>
                          ) : null}
                          {models.map(m => (
                            <option key={m.id} value={m.id}>
                              {m.label || modelLabel(catalog, m.id)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>
                )
              })}
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={savingFeatures}
                onClick={saveFeatures}
              >
                {savingFeatures ? <span className="spinner" /> : 'Save AI Features'}
              </button>
            </div>
          </section>

          <section className="ai-settings-section">
            <h2 className="integrations-section-title">Marketing Assistant</h2>
            <p className="text-muted integrations-section-desc">
              The AI agent understands your requests, applies platform rules, collects missing details, builds workflows,
              and explains results in plain language. Generation steps use the providers configured in AI Features above.
            </p>
            <div className="card ai-planner-card">
              <div className="ai-feature-row">
                <div className="ai-feature-fields">
                  <div className="form-group">
                    <label className="form-label">Provider</label>
                    <select
                      className="form-input"
                      value={planner?.provider || ''}
                      onChange={e => setPlannerField({ provider: e.target.value })}
                    >
                      {(catalog?.planner_provider_ids || catalog?.provider_ids || []).map(pid => {
                        const connected = configuredIds.includes(pid)
                        return (
                          <option key={pid} value={pid} disabled={!connected}>
                            {connected ? '✓ ' : '✗ '}
                            {providerOptionLabel(catalog, pid, configuredIds)}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Model</label>
                    <select
                      className="form-input"
                      value={planner?.model || ''}
                      onChange={e => setPlannerField({ model: e.target.value })}
                      disabled={planner?.provider === 'ollama' && !plannerModels(catalog, planner?.provider).length}
                    >
                      {planner?.provider === 'ollama' && !plannerModels(catalog, planner?.provider).length ? (
                        <option value="">Test Ollama connection to load models</option>
                      ) : null}
                      {plannerModels(catalog, planner?.provider).map(m => (
                        <option key={m.id} value={m.id}>
                          {m.label || modelLabel(catalog, m.id)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <div className="form-group" style={{ maxWidth: 200 }}>
                <label className="form-label">Maximum Workflow Steps</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={50}
                  value={planner?.max_workflow_steps ?? 10}
                  onChange={e => setPlannerField({ max_workflow_steps: Number(e.target.value) })}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={savingPlanner}
                onClick={savePlanner}
              >
                {savingPlanner ? <span className="spinner" /> : 'Save Marketing Assistant'}
              </button>
            </div>
          </section>

          <section className="ai-settings-section">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <h2 className="integrations-section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Activity size={18} />
                  API Usage Log
                </h2>
                <p className="text-muted integrations-section-desc" style={{ marginBottom: 0 }}>
                  Every AI provider call for this workspace — tokens when reported by the API.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={executionsLoading}
                onClick={loadExecutions}
              >
                {executionsLoading ? <span className="spinner" /> : 'Refresh'}
              </button>
            </div>
            <div className="card" style={{ marginTop: '1rem', overflowX: 'auto' }}>
              {executionsLoading && !executions.length ? (
                <p className="text-muted" style={{ padding: '1rem' }}>Loading usage log…</p>
              ) : !executions.length ? (
                <p className="text-muted" style={{ padding: '1rem' }}>No AI calls recorded yet.</p>
              ) : (
                <table className="table table-hover-lift">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Feature</th>
                      <th>Model</th>
                      <th style={{ textAlign: 'right' }}>Input Tokens</th>
                      <th style={{ textAlign: 'right' }}>Output Tokens</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {executions.map(row => (
                      <tr key={row.id}>
                        <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(row.created_at)}</td>
                        <td>{row.feature}</td>
                        <td>{row.model_label || row.model || '—'}</td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatTokens(row.input_tokens, row.execution_type)}
                        </td>
                        <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatTokens(row.output_tokens, row.execution_type)}
                        </td>
                        <td>
                          {row.status === 'success' ? (
                            <span className="ai-status-badge ai-status-connected" style={{ fontSize: '0.72rem' }}>
                              <CheckCircle2 size={12} /> Success
                            </span>
                          ) : (
                            <span className="ai-status-badge ai-status-invalid" style={{ fontSize: '0.72rem' }} title={row.error || ''}>
                              <XCircle size={12} /> Failed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </>
      )}
    </AppLayout>
    </RequireWorkspaceAdmin>
  )
}
