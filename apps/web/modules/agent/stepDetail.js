/** Human-readable labels for workflow step payloads (agent UI). */

function formatDelay(minutes) {
  const m = Number(minutes)
  if (!Number.isFinite(m) || m <= 0) return null
  if (m % 60 === 0) {
    const h = m / 60
    return h === 1 ? '1 hour' : `${h} hours`
  }
  return m === 1 ? '1 minute' : `${m} minutes`
}

export function stepDetailLabel(step, { formatDateTime } = {}) {
  const tool = step?.tool_id
  const p = step?.payload || {}

  if (tool === 'create_draft_post') {
    return 'Save draft post'
  }

  if (tool === 'schedule_post') {
    const delay = formatDelay(p.schedule_in_minutes)
    if (delay) return `Schedule publish · go live in ${delay}`
    if (p.scheduled_at) {
      const when = formatDateTime
        ? formatDateTime(p.scheduled_at)
        : p.scheduled_at
      return `Schedule publish · at ${when}`
    }
    return 'Schedule publish for later'
  }

  if (tool === 'publish_post') {
    return 'Publish immediately to connected accounts'
  }

  if (tool === 'generate_social_post') {
    return 'Generate post caption'
  }

  if (tool === 'generate_image_script') {
    return 'Write image prompt from post copy'
  }

  if (tool === 'generate_video_script') {
    return 'Write video script from post copy'
  }

  if (tool === 'generate_image') {
    return 'Generate image from script prompt'
  }

  if (tool === 'generate_video') {
    return 'Generate video from video script'
  }

  if (tool === 'meta_publish_campaign' || tool === 'publish_campaign') {
    return 'Publish Meta campaign (campaign → ad set → creative → ad)'
  }
  if (tool === 'meta_create_campaign') return 'Create Meta campaign'
  if (tool === 'meta_create_adset') return 'Create Meta ad set'
  if (tool === 'meta_create_creative') return 'Create Meta ad creative'
  if (tool === 'meta_create_ad') return 'Create Meta ad'
  if (tool === 'meta_report_insights') return 'Fetch Meta Ads insights'
  if (tool === 'meta_list_campaigns') return 'List Meta campaigns'
  if (tool === 'meta_list_adsets') return 'List Meta ad sets'
  if (tool === 'meta_list_ads') return 'List Meta ads'
  if (tool === 'meta_get_ad_accounts') return 'List Meta ad accounts'
  if (tool === 'meta_get_account') return 'Get Meta ad account details'
  if (tool === 'meta_create_budget_schedule') return 'Schedule Meta high-demand budget boost'
  if (tool === 'meta_get_account_pages') return 'List Facebook Pages for ad account'
  if (tool === 'meta_list_ad_pixels') return 'List Meta pixels on ad account (auto-select when one)'
  if (tool === 'meta_get_ad_pixel') return 'Get Meta pixel details (GET pixel node)'
  if (tool === 'meta_create_ad_pixel') return 'Admin: create Meta pixel (not for campaign workflows)'
  if (tool === 'meta_update_ad_pixel') return 'Admin: update Meta pixel settings (not for campaign workflows)'
  if (tool === 'meta_search_geo_locations') return 'Search Meta geo locations'
  if (tool === 'meta_resolve_geo_targeting') return 'Resolve Meta geo targeting (include/exclude)'
  if (tool === 'meta_search_interests') return 'Search Meta interests'
  if (tool === 'meta_search_ads_library') return 'Search Meta Ads Library'
  if (tool === 'meta_estimate_audience_size') return 'Estimate Meta audience size'

  if (tool === 'google_publish_campaign') return 'Publish Google campaign (full chain by type)'
  if (tool === 'google_publish_search_campaign') return 'Publish Search (budget → RSA + keywords)'
  if (tool === 'google_publish_display_campaign') return 'Publish Display (budget → RDA)'
  if (tool === 'google_publish_video_campaign') return 'Publish Video (budget → YouTube ad)'
  if (tool === 'google_publish_shopping_campaign') return 'Publish Shopping (budget → listing group)'
  if (tool === 'google_publish_performance_max_campaign') return 'Publish Performance Max (asset group + assets)'
  if (tool === 'google_publish_app_campaign') return 'Publish App campaign (budget → app ad)'
  if (tool === 'google_publish_local_campaign') return 'Publish Local campaign (budget → local ad)'
  if (tool === 'google_create_campaign') return 'Create Google Ads campaign chain'
  if (tool === 'google_create_search_campaign') return 'Create Google Search campaign'
  if (tool === 'google_create_budget') return 'Create Google Ads budget'
  if (tool === 'google_list_campaigns') return 'List Google Ads campaigns'
  if (tool === 'google_update_campaign') return 'Update Google Ads campaign status'
  if (tool === 'google_update_campaign_geo_target') return 'Update Google geo targeting mode'
  if (tool === 'google_create_geo_targeting') return 'Add Google location targeting'
  if (tool === 'google_resolve_geo_targeting') return 'Resolve Google geo targeting (include/exclude)'
  if (tool === 'google_exclude_geo_targets') return 'Exclude Google locations'
  if (tool === 'google_add_negative_keywords') return 'Add Google negative keywords'
  if (tool === 'google_remove_campaign_criterion') return 'Remove Google campaign criterion'
  if (tool === 'google_create_adgroup') return 'Create Google ad group'
  if (tool === 'google_update_adgroup') return 'Update Google ad group status'
  if (tool === 'google_add_keywords') return 'Add Google keywords'
  if (tool === 'google_create_ad') return 'Create Google responsive search ad'
  if (tool === 'google_get_ad_accounts') return 'List Google Ads accounts'
  if (tool === 'google_get_account') return 'Get Google Ads customer profile'
  if (tool === 'google_get_campaign') return 'Get Google Ads campaign details'
  if (tool === 'google_list_ad_groups') return 'List Google ad groups'
  if (tool === 'google_report_performance') return 'Google Ads performance report'
  if (tool === 'google_report_gaql') return 'Run Google Ads GAQL query'
  if (tool === 'google_docs_gaql') return 'Read GAQL documentation'
  if (tool === 'google_docs_reporting_views') return 'Read Google reporting view docs'
  if (tool === 'google_docs_reporting_fields') return 'Look up GAQL field metadata'
  if (tool === 'google_get_account_hierarchy') return 'Get Google account hierarchy'
  if (tool === 'google_get_ad_group') return 'Get Google ad group'
  if (tool === 'google_list_keywords') return 'List Google keywords'
  if (tool === 'google_list_ads_read') return 'List Google ads'
  if (tool === 'google_suggest_negative_keywords') return 'Suggest negative keywords from search terms'
  if (tool === 'analyze_competitive_landscape') return 'Competitive analysis (scrape + Ads Library + AI)'
  if (tool === 'cluster_seo_keywords') return 'Cluster SEO keywords by intent'
  if (tool === 'check_seo_keyword_ranks') return 'Check keyword SERP ranks'
  if (tool === 'audit_seo_landing_pages') return 'Audit landing pages for SEO'
  if (tool === 'run_landing_page_workflow') return 'Create landing page with AI copy'
  if (tool === 'google_get_recommendations') return 'Fetch Google recommendations'
  if (tool === 'google_apply_recommendation') return 'Apply Google recommendation'
  if (tool === 'google_report_account_summary') return 'Google account summary'
  if (tool === 'google_report_optimization_hints') return 'Google optimization hints'
  if (tool === 'google_report_ads') return 'Google ads performance report'
  if (tool === 'google_create_ad_schedule') return 'Set ad schedule (dayparting)'
  if (tool === 'google_set_bid_adjustments') return 'Set device/location bid adjustments'
  if (tool === 'google_create_custom_audience') return 'Create remarketing audience'
  if (tool === 'google_list_audiences') return 'List remarketing audiences'
  if (tool === 'google_add_audience_targeting') return 'Add audience to ad group'
  if (tool === 'google_optimize_geographic_targeting') return 'Geo performance recommendations'
  if (tool === 'google_get_location_performance') return 'Location performance report'
  if (tool === 'google_get_device_performance') return 'Device performance report'
  if (tool === 'google_get_change_history') return 'Google change history'
  if (tool === 'google_copy_campaign') return 'Copy Google campaign'
  if (tool === 'google_pause_campaign') return 'Pause Google campaign'
  if (tool === 'google_resume_campaign') return 'Resume Google campaign'
  if (tool === 'google_delete_campaign') return 'Delete Google campaign'
  if (tool === 'google_create_expanded_text_ad') return 'Create expanded text ad (legacy)'
  if (tool === 'google_create_structured_snippet_extensions') return 'Add structured snippet extensions'
  if (tool === 'google_create_call_extensions') return 'Add call extensions'
  if (tool === 'google_list_extensions') return 'List campaign extensions'
  if (tool === 'google_delete_extension') return 'Remove campaign extension'
  if (tool === 'google_update_keyword_bid') return 'Update keyword bid'
  if (tool === 'google_pause_keyword') return 'Pause keyword'
  if (tool === 'google_enable_keyword') return 'Enable keyword'
  if (tool === 'google_delete_keyword') return 'Delete keyword'
  if (tool === 'google_pause_ad') return 'Pause ad'
  if (tool === 'google_enable_ad') return 'Enable ad'
  if (tool === 'google_delete_ad') return 'Delete ad'
  if (tool === 'google_update_adgroup_full') return 'Update Google ad group'
  if (tool === 'google_list_budgets') return 'List Google budgets'
  if (tool === 'google_update_budget') return 'Update Google budget'

  if (tool?.startsWith('google_') && p.name) {
    return `${tool.replace(/^google_/, '').replace(/_/g, ' ')} · ${p.name}`
  }
  if (tool?.startsWith('google_')) {
    return tool.replace(/^google_/, '').replace(/_/g, ' ')
  }

  return null
}
