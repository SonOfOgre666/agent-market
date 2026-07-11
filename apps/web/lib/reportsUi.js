import { PROVIDER_LABEL } from './commentUi.js'

/** Facebook `facebook_insights.type` → metric key (Graph API metric names). */
export const FACEBOOK_INSIGHT_TYPE_KEYS = {
  1: 'page_post_engagements',
  2: 'page_posts_impressions',
}

const FB_DOCS = 'https://developers.facebook.com/docs/graph-api/reference/page/insights'
const IG_DOCS = 'https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights'
const X_DOCS = 'https://docs.x.com/x-api/fundamentals/metrics'
const LI_DOCS = 'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/share-statistics'
const TT_DOCS = 'https://developers.tiktok.com/doc/content-posting-api-get-started'

/**
 * Per-provider report definitions aligned with official platform APIs.
 * `wired: true` = backend import exists today; `false` = API supports it but not connected.
 */
export const PROVIDER_REPORTS = {
  twitter: {
    label: PROVIDER_LABEL.twitter,
    docsUrl: X_DOCS,
    metricsSource: 'metrics',
    audience: true,
    statCards: [
      { key: 'impressions', label: 'Impressions', wired: true, note: 'public_metrics.impression_count' },
      { key: 'likes', label: 'Likes', wired: true, note: 'public_metrics.like_count' },
      { key: 'replies', label: 'Replies', wired: true, note: 'public_metrics.reply_count' },
      { key: 'retweets', label: 'Reposts', wired: true, note: 'public_metrics.retweet_count' },
    ],
    charts: [
      {
        title: 'Impressions',
        series: [{ key: 'impressions', label: 'Impressions', color: '#6366f1' }],
      },
      {
        title: 'Engagement',
        series: [
          { key: 'likes', label: 'Likes', color: '#f59e0b' },
          { key: 'replies', label: 'Replies', color: '#10b981' },
          { key: 'retweets', label: 'Reposts', color: '#f43f5e' },
        ],
      },
    ],
    officialOnly: [
      { label: 'Quotes', note: 'public_metrics.quote_count' },
      { label: 'Bookmarks', note: 'public_metrics.bookmark_count' },
      { label: 'Link clicks', note: 'non_public_metrics (owned tweets, user auth)' },
    ],
    limitations: [
      'Tweet metrics import requires X API Basic tier or higher (Free tier is skipped).',
      'Private metrics (clicks, engagements) need user-context auth and are not imported yet.',
    ],
  },

  facebook: {
    label: PROVIDER_LABEL.facebook,
    docsUrl: FB_DOCS,
    metricsSource: 'facebook_insights_daily',
    audience: true,
    statCards: [
      { key: 'page_post_engagements', label: 'Post engagements', wired: true, note: 'Page Insights (daily)' },
      { key: 'page_posts_impressions', label: 'Post impressions', wired: true, note: 'Page Insights (daily)' },
    ],
    charts: [
      {
        title: 'Page post impressions',
        series: [{ key: 'page_posts_impressions', label: 'Post impressions', color: '#6366f1' }],
      },
      {
        title: 'Page post engagements',
        series: [{ key: 'page_post_engagements', label: 'Post engagements', color: '#22d3ee' }],
      },
    ],
    officialOnly: [
      { label: 'Page views', note: 'page_media_view (replacing impressions, Meta 2025)' },
      { label: 'Page reach', note: 'page_impressions_unique' },
      { label: 'Post-level metrics', note: '/{post-id}/insights' },
    ],
    limitations: [
      'Metrics are page-level daily insights, not per-post breakdown.',
      'Meta is deprecating legacy impression metrics in favor of views (see Page Insights changelog).',
    ],
  },

  facebook_page: {
    extends: 'facebook',
  },

  instagram: {
    label: PROVIDER_LABEL.instagram,
    docsUrl: IG_DOCS,
    metricsSource: 'metrics',
    audience: true,
    statCards: [
      { key: 'reach', label: 'Reach', wired: true, note: 'Account insights (unique accounts)' },
      { key: 'views', label: 'Views', wired: true, note: 'Account insights (content plays)' },
      { key: 'likes', label: 'Likes', wired: true, note: 'Sum of media likes by post date' },
      { key: 'comments', label: 'Comments', wired: true, note: 'Sum of media comments by post date' },
    ],
    charts: [
      {
        title: 'Account reach & views',
        series: [
          { key: 'reach', label: 'Reach', color: '#6366f1' },
          { key: 'views', label: 'Views', color: '#22d3ee' },
        ],
      },
      {
        title: 'Media engagement',
        series: [
          { key: 'likes', label: 'Likes', color: '#f59e0b' },
          { key: 'comments', label: 'Comments', color: '#10b981' },
        ],
      },
    ],
    officialOnly: [
      { label: 'Shares', note: 'per-media insights' },
      { label: 'Saved', note: 'per-media insights' },
    ],
    limitations: [
      'Reach and views need instagram_business_manage_insights — reconnect the account if those stay empty.',
      'Media metrics are grouped by post publish date (last ~90 days).',
      'Accounts under 100 followers may not return full insights per Meta.',
    ],
  },

  instagram_login: {
    extends: 'instagram',
  },

  linkedin: {
    label: PROVIDER_LABEL.linkedin,
    docsUrl: LI_DOCS,
    metricsSource: 'none',
    audience: false,
    statCards: [],
    charts: [],
    officialOnly: [
      { label: 'Impressions', note: 'organizationalEntityShareStatistics.impressionCount' },
      { label: 'Engagement rate', note: 'share statistics engagement' },
      { label: 'Likes', note: 'likeCount' },
      { label: 'Comments', note: 'commentCount' },
      { label: 'Shares', note: 'shareCount' },
      { label: 'Clicks', note: 'clickCount' },
      { label: 'Followers', note: 'organizationalEntityFollowerStatistics / networkSizes' },
    ],
    limitations: [
      'No analytics import is connected for LinkedIn yet.',
      'Organic share statistics are available via the Marketing API when implemented.',
    ],
  },

  tiktok: {
    label: PROVIDER_LABEL.tiktok,
    docsUrl: TT_DOCS,
    metricsSource: 'none',
    audience: false,
    statCards: [],
    charts: [],
    officialOnly: [
      { label: 'Video views', note: 'Display / Analytics API video stats' },
      { label: 'Likes, comments, shares', note: 'per-video engagement' },
      { label: 'Followers', note: 'profile follower count' },
    ],
    limitations: [
      'This workspace uses TikTok Content Posting API for publish only.',
      'Organic video analytics are not imported into Reports yet.',
    ],
  },
}

function resolveProviderConfig(provider) {
  const raw = PROVIDER_REPORTS[provider] || PROVIDER_REPORTS.twitter
  if (raw.extends) {
    const base = PROVIDER_REPORTS[raw.extends]
    return {
      ...base,
      ...raw,
      statCards: raw.statCards?.length ? raw.statCards : base.statCards,
      charts: raw.charts?.length ? raw.charts : base.charts,
      officialOnly: raw.officialOnly?.length ? raw.officialOnly : base.officialOnly,
      limitations: raw.limitations || base.limitations,
    }
  }
  return raw
}

export function getReportsConfig(provider) {
  return resolveProviderConfig(provider || 'twitter')
}

/** Pivot API rows `{ date, type, value }` into daily chart rows. */
export function pivotFacebookInsights(rows = []) {
  const byDate = {}
  for (const row of rows) {
    const date = row.date
    if (!date) continue
    const key = FACEBOOK_INSIGHT_TYPE_KEYS[row.type] || `metric_${row.type}`
    if (!byDate[date]) byDate[date] = { date }
    byDate[date][key] = Number(row.value) || 0
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}

function metricsRowsFromSource(data, config) {
  if (config.metricsSource === 'metrics') {
    return (data?.metrics || []).map((m) => ({ date: m.date, ...(m.data || {}) }))
  }
  if (config.metricsSource === 'facebook_insights_daily') {
    if (data?.facebook_insights_daily?.length) return data.facebook_insights_daily
    return pivotFacebookInsights(data?.facebook_insights)
  }
  return []
}

export function buildMetricsChart(data, provider) {
  const config = getReportsConfig(provider)
  return metricsRowsFromSource(data, config)
}

export function sumMetric(rows, key) {
  return rows.reduce((s, d) => s + (Number(d[key]) || 0), 0)
}

export function chartHasData(rows, keys) {
  return rows.some((d) => keys.some((k) => Number(d[k]) > 0))
}

export function reportsHasContent(data, provider) {
  const config = getReportsConfig(provider)
  const metrics = buildMetricsChart(data, provider)
  const audience = data?.audience || []
  const hasMetrics = chartHasData(
    metrics,
    config.statCards.map((c) => c.key).concat(config.charts.flatMap((ch) => ch.series.map((s) => s.key))),
  )
  const hasAudience = config.audience && audience.length > 0
  return hasMetrics || hasAudience
}
