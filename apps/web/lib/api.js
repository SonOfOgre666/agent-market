const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

function getToken() {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('agentmarket_token')
}

async function request(method, path, body, options = {}, attempt = 0) {
  const token = getToken()
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (body !== undefined && body !== null) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(`${API_URL}/api${path}`, {
      method,
      headers,
      ...(body !== undefined && body !== null ? { body: JSON.stringify(body) } : {}),
      ...options,
    })
  } catch (err) {
    // Retry once on network-level failures (ERR_NETWORK_CHANGED, ERR_FAILED, etc.)
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 800 * (attempt + 1)))
      return request(method, path, body, options, attempt + 1)
    }
    throw new Error('Network error — please check your connection and try again')
  }

  if (res.status === 401) {
    localStorage.removeItem('agentmarket_token')
    window.location.href = '/login'
    return
  }

  if (res.status === 204) return null

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
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
  schedulePost: (id, scheduled_at) => request('POST', `/posts/${id}/schedule`, { scheduled_at }),
  duplicatePost: (id) => request('POST', `/posts/${id}/duplicate`),

  // Accounts
  accounts: () => request('GET', '/accounts'),
  addAccount: (provider, data) => request('POST', `/accounts/add/${provider}`, data),
  refreshAccount: (id) => request('PUT', `/accounts/${id}`),
  deleteAccount: (id) => request('DELETE', `/accounts/${id}`),
  accountEntities: (provider, parent_key) => request('GET', `/accounts/entities/${provider}?parent_key=${parent_key || ''}`),
  saveEntity: (provider, entity, parent_key) => request('POST', `/accounts/entities/${provider}`, { entity, parent_key }),

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
    const res = await fetch(`${API_URL}/api/media/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Upload failed')
    return data
  },

  // Tags
  tags: () => request('GET', '/tags'),
  createTag: (data) => request('POST', '/tags', data),
  updateTag: (id, data) => request('PUT', `/tags/${id}`, data),
  deleteTag: (id) => request('DELETE', `/tags/${id}`),

  // Calendar
  calendar: (date, type) => request('GET', `/calendar?date=${date}&type=${type}`),

  // Reports
  reports: (params) => request('GET', `/reports?${new URLSearchParams(params)}`),

  // Settings
  settings: () => request('GET', '/settings'),
  saveSettings: (data) => request('PUT', '/settings', data),

  // Services
  services: () => request('GET', '/services'),
  saveService: (name, data) => request('PUT', `/services/${name}`, data),
  createMastodonApp: (server_url) => request('POST', '/services/mastodon/create-app', { server_url }),

  // Profile
  profile: () => request('GET', '/profile'),
  updateProfile: (data) => request('PUT', '/profile/user', data),
  changePassword: (data) => request('PUT', '/profile/password', data),

  // Ads — Campaigns
  campaigns: (params = {}) => request('GET', `/ads/campaigns?${new URLSearchParams(params)}`),
  campaign: (id) => request('GET', `/ads/campaigns/${id}`),
  createCampaign: (data) => request('POST', '/ads/campaigns', data),
  updateCampaign: (id, data) => request('PATCH', `/ads/campaigns/${id}`, data),
  deleteCampaign: (id) => request('DELETE', `/ads/campaigns/${id}`),

  // Ads — Landing Pages
  landingPages: (params = {}) => request('GET', `/ads/landing-pages?${new URLSearchParams(params)}`),
  landingPage: (id) => request('GET', `/ads/landing-pages/${id}`),
  createLandingPage: (data) => request('POST', '/ads/landing-pages', data),
  updateLandingPage: (id, data) => request('PATCH', `/ads/landing-pages/${id}`, data),
  deleteLandingPage: (id) => request('DELETE', `/ads/landing-pages/${id}`),

  // Ads — Leads
  leads: (params = {}) => request('GET', `/ads/leads?${new URLSearchParams(params)}`),

  // Ads — Budget summary
  budgetSummary: () => request('GET', '/ads/budget-summary'),
  syncGoogleAdsCampaigns: () => request('POST', '/ads/google-ads/sync'),
  googleAdsCustomers: () => request('GET', '/ads/google-ads/customers'),

  // System
  systemStatus: () => request('GET', '/system/status'),
  systemLogs: () => request('GET', '/system/logs'),
  clearLogs: () => request('DELETE', '/system/logs'),
}
