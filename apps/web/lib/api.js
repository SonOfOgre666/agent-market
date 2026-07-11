const API_PUBLIC_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4010').replace(/\/$/, '')

function isNgrokUrl(url) {
  try {
    const host = new URL(url).hostname
    return host.endsWith('ngrok-free.dev') || host.endsWith('ngrok.io') || host.endsWith('ngrok.app')
  } catch {
    return false
  }
}

/** When the page and API are different origins, fetch via Next rewrite (same-origin) so ngrok OPTIONS/CORS cannot break login. */
function browserUsesApiProxy() {
  if (typeof window === 'undefined') return false
  try {
    return new URL(API_PUBLIC_BASE).origin !== window.location.origin
  } catch {
    return false
  }
}

function ngrokSkipHeaders() {
  if (browserUsesApiProxy()) return {}
  return isNgrokUrl(API_PUBLIC_BASE) ? { 'ngrok-skip-browser-warning': 'true' } : {}
}

/** Path includes leading slash, e.g. `/login` or `/posts?page=1` */
function buildApiFetchUrl(path) {
  if (typeof window === 'undefined') return `${API_PUBLIC_BASE}/api${path}`
  if (browserUsesApiProxy()) return `/__agentmarket_api${path}`
  return `${API_PUBLIC_BASE}/api${path}`
}

/** Absolute URL the browser will request (for error messages). */
function browserAttemptedFetchUrl(path) {
  const u = buildApiFetchUrl(path)
  if (typeof window === 'undefined' || u.startsWith('http')) return u
  const origin = window.location.origin.replace(/\/$/, '')
  return `${origin}${u.startsWith('/') ? u : `/${u}`}`
}

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('agentmarket_token')
}

/** Omit undefined/null/'' — URLSearchParams stringifies undefined as "undefined". */
function queryString(params = {}) {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  )
  const qs = new URLSearchParams(entries).toString()
  return qs ? `?${qs}` : ''
}

async function request(method, path, body, options = {}, attempt = 0) {
  const { auth = true, ...fetchOpts } = options
  const token = auth ? getToken() : null
  const headers = { ...ngrokSkipHeaders() }
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(buildApiFetchUrl(path), {
      method,
      headers,
      ...(body !== undefined && body !== null ? { body: JSON.stringify(body) } : {}),
      ...fetchOpts,
    })
  } catch (err) {
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
      return request(method, path, body, options, attempt + 1)
    }
    const pageHttps =
      typeof window !== 'undefined' &&
      window.location.protocol === 'https:'
    const apiHttpLocal =
      API_PUBLIC_BASE.startsWith('http://') &&
      /localhost|127\.0\.0\.1/i.test(API_PUBLIC_BASE)
    if (pageHttps && apiHttpLocal) {
      throw new Error(
        'API is configured as http://localhost but this page is HTTPS — the browser blocks that (mixed content). Set NEXT_PUBLIC_API_URL to your public HTTPS API URL (e.g. ngrok) in .env and restart the web app.'
      )
    }
    const attempted = typeof window !== 'undefined' ? browserAttemptedFetchUrl(path) : buildApiFetchUrl(path)
    const proxyHint =
      browserUsesApiProxy() && typeof window !== 'undefined'
        ? ` The browser called your Next app at ${attempted} (same-origin proxy). That means either (1) this page’s origin cannot reach Next (tunnel down / wrong host), or (2) Next cannot reach the API — set NEXT_REWRITE_API_URL=http://127.0.0.1:4010 in the repo-root .env (same folder as start.sh), then stop and restart \`next dev\` so rewrites reload. Verify API: curl -sS http://127.0.0.1:4010/api/health`
        : ` Tried: ${attempted}. Check NEXT_PUBLIC_API_URL, tunnels, and that the API accepts browser requests.`
    throw new Error(
      `Network error — fetch failed before any HTTP response. Configured public API base: ${API_PUBLIC_BASE}.${proxyHint}`
    )
  }

  if (res.status === 204) return null

  const raw = await res.text()
  let data = null
  if (raw) {
    try {
      data = JSON.parse(raw)
    } catch {
      const proxyHint =
        browserUsesApiProxy() && res.status === 502
          ? ' Next.js could not reach the API for /__agentmarket_api (avoid proxying to ngrok from Node). Set NEXT_REWRITE_API_URL=http://127.0.0.1:4010 in repo-root .env and restart `next dev`, or run ./start.sh to add it.'
          : ''
      throw new Error(`API returned non-JSON (HTTP ${res.status}).${proxyHint}`)
    }
  }

  if (res.status === 401) {
    if (auth && typeof window !== 'undefined') {
      localStorage.removeItem('agentmarket_token')
      window.location.href = '/login'
      return
    }
    throw new Error((data && data.error) || 'Unauthorized')
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`)
    if (data && typeof data === 'object') err.body = data
    throw err
  }
  return data
}

/** POST /ai/* returns 202 + job_id; poll GET /ai/jobs/:id until complete (worker runs Gemini). */
async function waitForAiJob(jobId, options = {}) {
  const { intervalMs = 350, maxWaitMs = 300000 } = options
  const path = `/ai/jobs/${encodeURIComponent(jobId)}`
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await request('GET', path)
    if (res?.status === 'complete' && res.ok) return res.data
    if (res?.status === 'complete' && !res.ok) {
      throw new Error(res.error || 'AI generation failed')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('AI job timed out — check that the Celery worker is running.')
}

async function aiJobFromPost(path, body, waitOptions) {
  const res = await request('POST', path, body)
  if (res?.job_id) return waitForAiJob(res.job_id, waitOptions)
  throw new Error('Unexpected AI API response (missing job_id)')
}

async function waitForAgentJob(jobId, options = {}) {
  const { intervalMs = 400, maxWaitMs = 120000 } = options
  const path = `/agent/jobs/${encodeURIComponent(jobId)}`
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const res = await request('GET', path)
    if (res?.status === 'complete' && res.ok) return res.data
    if (res?.status === 'complete' && !res.ok) {
      throw new Error(res.error || 'Agent task failed')
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Agent job timed out — check that the Celery worker is running.')
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path, body) => request('DELETE', path, body),

  // Auth
  login: (email, password) => request('POST', '/login', { email, password }),
  register: (name, email, password, invite_token) => request('POST', '/register', { name, email, password, ...(invite_token ? { invite_token } : {}) }),
  logout: () => request('POST', '/logout'),
  me: () => request('GET', '/me'),
  switchWorkspace: (workspace_id) => request('POST', '/switch-workspace', { workspace_id }),

  // Workspace
  workspace: () => request('GET', '/workspace'),
  updateWorkspace: (data) => request('PATCH', '/workspace', data),
  inviteMember: (email, role) => request('POST', '/workspace/invite', { email, role }),
  revokeInvite: (token) => request('DELETE', `/workspace/invites/${token}`),
  updateMemberRole: (userId, role) => request('PATCH', `/workspace/members/${userId}`, { role }),
  removeMember: (userId) => request('DELETE', `/workspace/members/${userId}`),

  // Dashboard
  dashboard: () => request('GET', '/dashboard'),

  // Posts
  posts: (params = {}) => request('GET', `/posts?${new URLSearchParams(params)}`),
  post: (id) => request('GET', `/posts/${id}`),
  createPost: (data) => request('POST', '/posts', data),
  updatePost: (id, data) => request('PUT', `/posts/${id}`, data),
  deletePost: (id) => request('DELETE', `/posts/${id}`),
  deletePosts: (ids) => request('DELETE', '/posts', { ids }),
  schedulePost: (id, data) => request('POST', `/posts/${id}/schedule`, typeof data === 'string' ? { scheduled_at: data } : (data || {})),
  /** Calendar / UI: one API-owned path for moving a post to a new scheduled_at (draft vs scheduled rules server-side). */
  reschedulePost: (id, scheduled_at) => request('POST', `/posts/${id}/reschedule`, { scheduled_at }),
  publishPost: (id, body) => request('POST', `/posts/${id}/publish`, body || {}),
  duplicatePost: (id) => request('POST', `/posts/${id}/duplicate`),
  /** Per-account publish results for a post */
  postPublishAccounts: (id) => request('GET', `/posts/${id}/accounts`),
  postComments: (id) => request('GET', `/posts/${id}/comments`),
  syncPostComments: (id) => request('POST', `/posts/${id}/comments/sync`),
  analyzePostComment: (postId, commentId) => request('POST', `/posts/${postId}/comments/${commentId}/analyze`),
  replyPostComment: (postId, commentId, text) => request('POST', `/posts/${postId}/comments/${commentId}/reply`, { text }),

  // Accounts — kind: 'social' | 'ads' (omit for all)
  accounts: (params = {}) => {
    const q = new URLSearchParams()
    if (params.kind) q.set('kind', params.kind)
    const qs = q.toString()
    return request('GET', qs ? `/accounts?${qs}` : '/accounts')
  },
  addAccount: (provider, data = {}, options = {}) =>
    request('POST', `/accounts/add/${provider}`, {
      ...data,
      ...(options.kind ? { kind: options.kind } : {}),
    }),
  refreshAccount: (id) => request('PUT', `/accounts/${id}`),
  queueAccountImports: (id) => request('POST', `/accounts/${id}/queue-imports`),
  deleteAccount: (id) => request('DELETE', `/accounts/${id}`),
  accountEntities: (provider, parent_key) => request('GET', `/accounts/entities/${provider}?parent_key=${parent_key || ''}`),
  saveEntity: (provider, entity, parent_key) => request('POST', `/accounts/entities/${provider}`, { entity, parent_key }),
  saveEntities: (provider, entities, parent_key) => request('POST', `/accounts/entities/${provider}`, { entities, parent_key }),
  /** Registry: meta_get_account_pages (requires Graph act_ id). */
  metaAccountPages: (account_id, ad_account_id) => {
    const q = new URLSearchParams({ account_id })
    if (ad_account_id) q.set('ad_account_id', ad_account_id)
    return request('GET', `/ads/facebook-pages?${q}`)
  },
  /** Registry: meta_list_ad_pixels (requires Graph act_ id). */
  metaPixels: (account_id, ad_account_id) => {
    const q = new URLSearchParams({ account_id })
    if (ad_account_id) q.set('ad_account_id', ad_account_id)
    return request('GET', `/ads/meta/pixels?${q}`)
  },
  /** @deprecated use metaAccountPages(account_id, ad_account_id) */
  facebookPages: (account_id, ad_account_id) => {
    const q = new URLSearchParams({ account_id })
    if (ad_account_id) q.set('ad_account_id', ad_account_id)
    return request('GET', `/ads/facebook-pages?${q}`)
  },
  /** @deprecated Prefer listMetaAdAccounts() in metaAdsTools.js (POST /ads/tools/execute — same path as the agent). Kept for scripts and older clients. */
  metaAdAccountsList: (account_id) =>
    request('GET', `/ads/meta/ad-accounts?account_id=${encodeURIComponent(account_id)}`),

  // Media
  media: (params = {}) => request('GET', `/media?${new URLSearchParams(params)}`),
  deleteMedia: (ids) => request('DELETE', '/media', { ids }),
  fetchUploaded: (page = 1) => request('GET', `/media/fetch/uploaded?page=${page}`),
  fetchStock: (query, page = 1) => request('GET', `/media/fetch/stock?query=${encodeURIComponent(query)}&page=${page}`),
  fetchGifs: (query, page = 1) => request('GET', `/media/fetch/gifs?query=${encodeURIComponent(query)}&page=${page}`),
  downloadMedia: (url, source) => request('POST', '/media/download', { url, source }),
  uploadMedia: async (file) => {
    const token = getToken()
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(buildApiFetchUrl('/media/upload'), {
      method: 'POST',
      headers: token
        ? { ...ngrokSkipHeaders(), Authorization: `Bearer ${token}` }
        : { ...ngrokSkipHeaders() },
      body: form,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Upload failed')
    return data
  },

  // Calendar
  calendar: (date) => request('GET', `/calendar?date=${encodeURIComponent(date)}`),

  // Reports
  reports: (params) => request('GET', `/reports?${new URLSearchParams(params)}`),

  // Settings
  settings: () => request('GET', '/settings'),
  saveSettings: (data) => request('PUT', '/settings', data),

  // Integrations (workspace API credentials)
  integrations: () => request('GET', '/integrations/configs'),
  saveIntegration: (name, data) => request('PUT', `/integrations/configs/${name}`, data),

  // AI settings (providers, features, planner)
  aiWorkspace: () => request('GET', '/ai/workspace'),
  aiExecutions: (params = {}) => request('GET', `/ai/executions${queryString(params)}`),
  saveAiProvider: (name, data) => request('PUT', `/ai/providers/${name}`, data),
  testAiProvider: (name, data) => request('POST', `/ai/providers/${name}/test`, data),
  saveAiFeatures: (features) => request('PUT', '/ai/features', { features }),
  saveAiPlanner: (planner) => request('PUT', '/ai/planner', { planner }),

  // Profile
  profile: () => request('GET', '/profile'),
  updateProfile: (data) => request('PUT', '/profile/user', data),
  changePassword: (data) => request('PUT', '/profile/password', data),

  // Ads — Campaigns
  campaigns: (params = {}) => request('GET', `/ads/campaigns${queryString(params)}`),
  campaign: (id) => request('GET', `/ads/campaigns/${id}`),
  createCampaign: (data) => request('POST', '/ads/campaigns', data),
  updateCampaign: (id, data) => request('PATCH', `/ads/campaigns/${id}`, data),
  deleteCampaign: (id) => request('DELETE', `/ads/campaigns/${id}`),
  publishCampaign: (id, data) => request('POST', `/ads/campaigns/${id}/publish`, data || {}),
  scheduleCampaign: (id, scheduled_at) => request('POST', `/ads/campaigns/${id}/schedule`, { scheduled_at }),
  unscheduleCampaign: (id) => request('DELETE', `/ads/campaigns/${id}/schedule`),
  adAccounts: () => request('GET', '/ads/ad-accounts'),
  adsWorkflowSchema: (platform) => request('GET', `/ads/workflows/${platform}/schema`),
  executeAdsTool: (tool_id, payload) => request('POST', '/ads/tools/execute', { tool_id, payload }),
  adsOptimizationHints: (account_id, params = {}) =>
    request('POST', '/ads/tools/execute', {
      tool_id: 'google_report_optimization_hints',
      payload: { account_id, ...params },
    }),

  // Ads — Landing Pages
  landingPages: (params = {}) => request('GET', `/ads/landing-pages${queryString(params)}`),
  landingPage: (id) => request('GET', `/ads/landing-pages/${id}`),
  /** Public slug page (/lp/:slug) — no auth; uses same API routes as automation. */
  publicLandingPageBySlug: (slug) =>
    request('GET', `/ads/landing-pages/${encodeURIComponent(slug)}`, undefined, { auth: false }),
  publicSubmitLandingLead: (slug, body) =>
    request('POST', `/ads/landing-pages/${encodeURIComponent(slug)}/lead`, body, { auth: false }),
  publicRecordAttributionTouch: (slug, body) =>
    request('POST', `/ads/landing-pages/${encodeURIComponent(slug)}/touch`, body, { auth: false }),
  createLandingPage: (data) => request('POST', '/ads/landing-pages', data),
  updateLandingPage: (id, data) => request('PATCH', `/ads/landing-pages/${id}`, data),
  deleteLandingPage: (id) => request('DELETE', `/ads/landing-pages/${id}`),
  runLandingPageWorkflow: (data) => request('POST', '/ads/landing-pages/workflow', data),
  runBudgetPacing: (data) => request('POST', '/ads/budget/pacing', data),
  runBudgetReallocation: (data) => request('POST', '/ads/budget/reallocation', data),
  applyBudgetReallocation: (data) => request('POST', '/ads/budget/reallocation/apply', data),
  runBidOptimization: (data) => request('POST', '/ads/optimization/bid', data),
  applyBidOptimization: (data) => request('POST', '/ads/optimization/bid/apply', data),
  qualityScoreMonitor: (params = {}) =>
    request('GET', `/ads/optimization/quality-score${queryString(params)}`),
  runAssetAbTest: (data) => request('POST', '/ads/optimization/asset-ab', data),
  applyAssetAbTest: (data) => request('POST', '/ads/optimization/asset-ab/apply', data),
  runCompetitiveAnalysis: (data) => request('POST', '/ads/competitive-analysis', data),
  recentCompetitiveAnalyses: (params = {}) =>
    request('GET', `/ads/competitive-analysis/recent${queryString(params)}`),
  leadAttribution: (params = {}) => request('GET', `/ads/leads/attribution${queryString(params)}`),
  downloadKpiReportPdf: async (params = {}) => {
    const token = getToken()
    const headers = { ...ngrokSkipHeaders() }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(buildApiFetchUrl(`/ads/reports/kpi-pdf${queryString(params)}`), { headers })
    if (!res.ok) {
      let message = res.statusText
      try {
        const err = await res.json()
        message = err.error || message
      } catch { /* binary or empty */ }
      throw new Error(message || 'PDF download failed')
    }
    return res.blob()
  },
  seoLandingPageAudit: () => request('GET', '/seo/landing-pages/audit'),
  seoKeywordTargets: () => request('GET', '/seo/keywords/targets'),
  addSeoKeywordTarget: (data) => request('POST', '/seo/keywords/targets', data),
  deleteSeoKeywordTarget: (id) => request('DELETE', `/seo/keywords/targets/${id}`),
  checkSeoKeywordRanks: (data) => request('POST', '/seo/keywords/check-ranks', data || {}),
  seoRankHistory: (params = {}) => request('GET', `/seo/keywords/rank-history${queryString(params)}`),
  clusterSeoKeywords: (data) => request('POST', '/seo/keywords/cluster', data),
  recentSeoKeywordClusters: (params = {}) =>
    request('GET', `/seo/keywords/clusters/recent${queryString(params)}`),
  suggestNegativeKeywords: (data) => request('POST', '/ads/negative-keywords/suggest', data),
  recentNegativeKeywords: (params = {}) =>
    request('GET', `/ads/negative-keywords/recent${queryString(params)}`),

  // Ads — Leads
  leads: (params = {}) => request('GET', `/ads/leads?${new URLSearchParams(params)}`),

  // Ads — Budget summary & platform sync
  budgetSummary: () => request('GET', '/ads/budget-summary'),
  syncGoogleAdsCampaigns: () => request('POST', '/ads/google-ads/sync'),
  googleAdsCustomers: (accountId) =>
    request(
      'GET',
      `/ads/google-ads/customers?${new URLSearchParams(accountId ? { account_id: accountId } : {})}`,
    ),
  setGoogleAdsCustomer: (accountId, payload) => {
    const body =
      typeof payload === 'string' || typeof payload === 'number'
        ? { customer_id: String(payload) }
        : payload
    return request('PATCH', `/accounts/${accountId}/google-customer`, body)
  },
  syncMetaCampaigns: (ad_account_id) => request('POST', '/ads/meta/sync', ad_account_id ? { ad_account_id } : {}),

  // Ads — Google Ads enhanced reporting
  googleCampaignPerformance: (params = {}) => request('GET', `/ads/google/performance?${new URLSearchParams(params)}`),
  googleAdGroups: (params = {}) => request('GET', `/ads/google/ad-groups?${new URLSearchParams(params)}`),
  googleKeywords: (params = {}) => request('GET', `/ads/google/keywords?${new URLSearchParams(params)}`),
  googleAds: (params = {}) => request('GET', `/ads/google/ads?${new URLSearchParams(params)}`),
  googleSearchTerms: (params = {}) => request('GET', `/ads/google/search-terms?${new URLSearchParams(params)}`),
  googleAccountSummary: (params = {}) => request('GET', `/ads/google/account-summary?${new URLSearchParams(params)}`),
  googleRunQuery: (query) => request('POST', '/ads/google/query', { query }),

  // Ads — Meta Ads reporting (GET routes → worker registry: meta_list_*, meta_report_insights)
  metaCampaigns: (params = {}) => request('GET', `/ads/meta/campaigns?${new URLSearchParams(params)}`),
  metaAdSets: (params = {}) => request('GET', `/ads/meta/ad-sets?${new URLSearchParams(params)}`),
  metaAds: (params = {}) => request('GET', `/ads/meta/ads?${new URLSearchParams(params)}`),
  /** Meta report_insights — pass account_id (Mongo), object_id, time_range or since/until, level, breakdown, compact, limit, after, etc. */
  metaInsights: (params = {}) => request('GET', `/ads/meta/insights?${new URLSearchParams(params)}`),

  // Ads — AI campaign actions
  generateCampaignAssets: (id) => request('POST', `/ads/campaigns/${id}/generate-assets`),
  generateLandingPage: (id) => request('POST', `/ads/campaigns/${id}/generate-landing-page`),
  optimizeCampaign: (id) => request('POST', `/ads/campaigns/${id}/optimize`),

  // Ads — Keywords
  suggestKeywords: (topic, language, country) => request('POST', '/ads/keywords/suggest', { topic, language, country }),

  // Integrations (OAuth — workspace accounts flow uses api.addAccount)
  integrationProviders: () => request('GET', '/integrations/providers'),

  // AI Post Creator
  aiGeneratePost: (data) => aiJobFromPost('/ai/generate-post', data, { maxWaitMs: 120000 }),
  aiPlanLandingPage: (data) => aiJobFromPost('/ai/plan-landing-page', data, { maxWaitMs: 120000 }),
  aiGenerateImageScript: (data) => aiJobFromPost('/ai/generate-image-script', data, { maxWaitMs: 120000 }),
  aiGenerateVideoScript: (data) => aiJobFromPost('/ai/generate-video-script', data, { maxWaitMs: 120000 }),
  aiGenerateImage: (data) => aiJobFromPost('/ai/generate-image', data, { maxWaitMs: 280000 }),
  aiGenerateVideo: (data) => aiJobFromPost('/ai/generate-video', data, { maxWaitMs: 620000 }),
  /** @deprecated use aiGenerateVideoScript */
  aiGenerateScript: (data) => aiJobFromPost('/ai/generate-video-script', data, { maxWaitMs: 120000 }),

  // Social automation — comment analysis (shared service; same as /social/comments/analyze)
  analyzeSocialComment: (data) => request('POST', '/posts/comments/analyze', data),
  socialComments: (params = {}) => {
    const q = new URLSearchParams(params).toString()
    return request('GET', q ? `/posts/comments?${q}` : '/posts/comments')
  },
  syncAllPostComments: () => request('POST', '/posts/comments/sync'),

  // Marketing assistant (planner agent — enqueue + poll; no execution in API)
  agentChat: (data) => request('POST', '/agent/chat', data),
  agentChatComplete: (data) => request('POST', '/agent/chat/complete', data),
  agentConversations: () => request('GET', '/agent/conversations'),
  agentConversation: (id) => request('GET', `/agent/conversations/${id}`),
  agentDeleteConversation: (id) => request('DELETE', `/agent/conversations/${id}`),
  agentWorkflows: (params = {}) => request('GET', `/agent/workflows?${new URLSearchParams(params)}`),
  agentWorkflow: (id) => request('GET', `/agent/workflows/${id}`),
  agentJob: (jobId) => request('GET', `/agent/jobs/${encodeURIComponent(jobId)}`),
  agentApproveWorkflow: (id) => request('POST', `/agent/workflows/${id}/approve`),
  agentExecuteWorkflow: (id) => request('POST', `/agent/workflows/${id}/execute`),
  agentRejectWorkflow: (id) => request('POST', `/agent/workflows/${id}/reject`),
  agentCancelWorkflow: (id) => request('POST', `/agent/workflows/${id}/cancel`),

}
