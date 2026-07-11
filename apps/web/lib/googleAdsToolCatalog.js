/**
 * Google Ads tool catalog — maps reference_ads/google_ads (tools_complete.py) to production google_* tools.
 * Used by GoogleAdsCampaignWizard Tool Console and granular builder.
 */

export const GOOGLE_WIZARD_MODES = [
  { id: 'guided', label: 'Guided launch', desc: 'Full end-to-end publish for every channel type' },
  { id: 'granular', label: 'Granular builder', desc: 'Run each mutation tool in order' },
  { id: 'tools', label: 'Tool console', desc: 'All reference tools — pick and execute' },
]

export const GOOGLE_TOOL_CATEGORIES = [
  { id: 'accounts', label: 'Accounts', icon: '🏢' },
  { id: 'campaigns', label: 'Campaigns', icon: '📣' },
  { id: 'budgets', label: 'Budgets', icon: '💰' },
  { id: 'ad_groups', label: 'Ad groups', icon: '📁' },
  { id: 'keywords', label: 'Keywords', icon: '🔑' },
  { id: 'ads', label: 'Ads & RSA', icon: '✍️' },
  { id: 'targeting', label: 'Geo & targeting', icon: '🌍' },
  { id: 'extensions', label: 'Extensions', icon: '🔗' },
  { id: 'assets', label: 'Assets', icon: '🖼️' },
  { id: 'reporting', label: 'Reporting', icon: '📊' },
  { id: 'docs', label: 'GAQL docs', icon: '📖' },
  { id: 'audiences', label: 'Audiences', icon: '👥' },
  { id: 'bidding', label: 'Bidding', icon: '⚖️' },
  { id: 'intelligence', label: 'Search intelligence', icon: '🔍' },
  { id: 'advanced', label: 'Advanced', icon: '⚙️' },
]

/** @typedef {{ name: string, label: string, type?: string, required?: boolean, placeholder?: string, options?: {value:string,label:string}[], hint?: string }} CatalogField */

/** @type {Array<{ ref: string, toolId: string|null, category: string, label: string, description: string, implemented: boolean, risk: string, fields: CatalogField[] }>} */
export const GOOGLE_TOOLS = [
  // Accounts
  { ref: 'list_accounts', toolId: 'google_get_ad_accounts', category: 'accounts', label: 'List accounts', description: 'Accessible customer IDs', implemented: true, risk: 'read', fields: [] },
  { ref: 'get_account_info', toolId: 'google_get_account', category: 'accounts', label: 'Account profile', description: 'Timezone, currency, status', implemented: true, risk: 'read', fields: [] },
  { ref: 'get_account_hierarchy', toolId: 'google_get_account_hierarchy', category: 'accounts', label: 'Account hierarchy', description: 'MCC tree', implemented: true, risk: 'read', fields: [] },

  // Campaigns
  { ref: 'create_campaign', toolId: 'google_create_campaign_with_budget', category: 'campaigns', label: 'Create campaign (+ budget)', description: 'Reference create_campaign — all channel types', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Campaign name', required: true },
    { name: 'budget_amount', label: 'Daily budget ($)', type: 'number', required: true },
    { name: 'campaign_type', label: 'Channel type', type: 'select', required: true, options: [
      { value: 'SEARCH', label: 'Search' },
      { value: 'DISPLAY', label: 'Display' },
      { value: 'VIDEO', label: 'Video' },
      { value: 'SHOPPING', label: 'Shopping' },
      { value: 'PERFORMANCE_MAX', label: 'Performance Max' },
      { value: 'MULTI_CHANNEL', label: 'App' },
      { value: 'LOCAL', label: 'Local' },
    ]},
    { name: 'start_date', label: 'Start date', type: 'date' },
    { name: 'end_date', label: 'End date', type: 'date' },
  ]},
  { ref: 'publish_search_campaign', toolId: 'google_publish_search_campaign', category: 'campaigns', label: 'Publish Search (full RSA)', description: 'Budget + campaign + ad group + keywords + RSA', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Campaign name', required: true },
    { name: 'budget_amount', label: 'Daily budget ($)', type: 'number', required: true },
    { name: 'final_url', label: 'Final URL', type: 'url', required: true },
    { name: 'headlines', label: 'Headlines (one per line)', type: 'textarea', required: true },
    { name: 'descriptions', label: 'Descriptions (one per line)', type: 'textarea', required: true },
    { name: 'keywords', label: 'Keywords (one per line)', type: 'textarea' },
  ]},
  { ref: 'publish_campaign', toolId: 'google_publish_campaign', category: 'campaigns', label: 'Publish (any type)', description: 'Routes by type — full end-to-end chain', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Campaign name', required: true },
    { name: 'type', label: 'Channel type', type: 'select', required: true, options: [
      { value: 'search', label: 'Search' }, { value: 'display', label: 'Display' },
      { value: 'video', label: 'Video' }, { value: 'shopping', label: 'Shopping' },
      { value: 'performance_max', label: 'Performance Max' }, { value: 'app', label: 'App' },
      { value: 'local', label: 'Local' },
    ]},
    { name: 'budget_amount', label: 'Daily budget ($)', type: 'number', required: true },
    { name: 'final_url', label: 'Final URL', type: 'url' },
    { name: 'merchant_id', label: 'Merchant ID (Shopping)', type: 'text' },
    { name: 'app_id', label: 'App ID (App campaigns)', type: 'text' },
    { name: 'youtube_video_id', label: 'YouTube video ID (Video)', type: 'text' },
  ]},
  { ref: 'publish_display_campaign', toolId: 'google_publish_display_campaign', category: 'campaigns', label: 'Publish Display (full RDA)', description: 'Budget + campaign + ad group + responsive display ad', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Campaign name', required: true },
    { name: 'budget_amount', label: 'Daily budget ($)', type: 'number', required: true },
    { name: 'final_url', label: 'Final URL', required: true },
    { name: 'headlines', label: 'Headlines', type: 'textarea', required: true },
    { name: 'descriptions', label: 'Descriptions', type: 'textarea', required: true },
  ]},
  { ref: 'publish_video_campaign', toolId: 'google_publish_video_campaign', category: 'campaigns', label: 'Publish Video (VIDEO_ACTION)', description: 'VideoResponsiveAd — requires logo + YouTube video', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Campaign name', required: true },
    { name: 'budget_amount', label: 'Daily budget ($)', type: 'number', required: true },
    { name: 'final_url', label: 'Final URL', required: true },
    { name: 'youtube_video_id', label: 'YouTube video ID', required: true },
    { name: 'business_name', label: 'Business name', required: true },
    { name: 'logo_image_data', label: 'Logo image (base64)', required: true },
    { name: 'target_cpa', label: 'Target CPA ($)', type: 'number' },
  ]},
  { ref: 'publish_shopping_campaign', toolId: 'google_publish_shopping_campaign', category: 'campaigns', label: 'Publish Shopping', description: 'Budget + shopping campaign + listing group', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Campaign name', required: true },
    { name: 'budget_amount', label: 'Daily budget ($)', type: 'number', required: true },
    { name: 'merchant_id', label: 'Merchant Center ID', required: true },
  ]},
  { ref: 'publish_performance_max_campaign', toolId: 'google_publish_performance_max_campaign', category: 'campaigns', label: 'Publish Performance Max', description: 'Budget + PMax + asset group + assets', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Campaign name', required: true },
    { name: 'budget_amount', label: 'Daily budget ($)', type: 'number', required: true },
    { name: 'final_url', label: 'Final URL', required: true },
    { name: 'headlines', label: 'Headlines (3+)', type: 'textarea', required: true },
    { name: 'descriptions', label: 'Descriptions (2+)', type: 'textarea', required: true },
  ]},
  { ref: 'publish_app_campaign', toolId: 'google_publish_app_campaign', category: 'campaigns', label: 'Publish App', description: 'Budget + app campaign + app ad', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Campaign name', required: true },
    { name: 'budget_amount', label: 'Daily budget ($)', type: 'number', required: true },
    { name: 'app_id', label: 'App store ID', required: true },
    { name: 'headlines', label: 'Headlines', type: 'textarea' },
  ]},
  { ref: 'publish_local_campaign', toolId: 'google_publish_local_campaign', category: 'campaigns', label: 'Publish Local (→ PMax)', description: 'Deprecated LOCAL — routes to Performance Max publish', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Campaign name', required: true },
    { name: 'budget_amount', label: 'Daily budget ($)', type: 'number', required: true },
    { name: 'final_url', label: 'Final URL' },
    { name: 'headlines', label: 'Headlines', type: 'textarea' },
  ]},
  { ref: 'create_typed_campaign', toolId: 'google_create_typed_campaign', category: 'campaigns', label: 'Create campaign on budget', description: 'Any channel type; requires budget_resource_name', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Name', required: true },
    { name: 'budget_resource_name', label: 'Budget resource name', required: true },
    { name: 'campaign_type', label: 'Channel', type: 'select', options: [
      { value: 'SEARCH', label: 'Search' }, { value: 'DISPLAY', label: 'Display' },
      { value: 'VIDEO', label: 'Video' }, { value: 'SHOPPING', label: 'Shopping' },
      { value: 'PERFORMANCE_MAX', label: 'Performance Max' }, { value: 'SMART', label: 'Smart' },
      { value: 'LOCAL', label: 'Local' },
    ]},
  ]},
  { ref: 'create_search_campaign', toolId: 'google_create_search_campaign', category: 'campaigns', label: 'Create Search campaign (legacy id)', description: 'Alias for SEARCH typed campaign', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Name', required: true },
    { name: 'budget_resource_name', label: 'Budget resource name', required: true },
  ]},
  { ref: 'list_campaigns', toolId: 'google_list_campaigns', category: 'campaigns', label: 'List campaigns', implemented: true, risk: 'read', fields: [{ name: 'limit', label: 'Limit', type: 'number' }] },
  { ref: 'get_campaign', toolId: 'google_get_campaign', category: 'campaigns', label: 'Get campaign', implemented: true, risk: 'read', fields: [{ name: 'platform_campaign_id', label: 'Campaign ID', required: true }] },
  { ref: 'update_campaign', toolId: 'google_update_campaign', category: 'campaigns', label: 'Update campaign status', implemented: true, risk: 'high', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'status', label: 'Status', type: 'select', required: true, options: [
      { value: 'active', label: 'Enabled' }, { value: 'paused', label: 'Paused' }, { value: 'ended', label: 'Removed' },
    ]},
  ]},
  { ref: 'pause_campaign', toolId: 'google_pause_campaign', category: 'campaigns', label: 'Pause campaign', implemented: true, risk: 'medium', fields: [{ name: 'platform_campaign_id', label: 'Campaign ID', required: true }] },
  { ref: 'resume_campaign', toolId: 'google_resume_campaign', category: 'campaigns', label: 'Resume campaign', implemented: true, risk: 'medium', fields: [{ name: 'platform_campaign_id', label: 'Campaign ID', required: true }] },
  { ref: 'delete_campaign', toolId: 'google_delete_campaign', category: 'campaigns', label: 'Delete campaign', implemented: true, risk: 'high', fields: [{ name: 'platform_campaign_id', label: 'Campaign ID', required: true }] },
  { ref: 'copy_campaign', toolId: 'google_copy_campaign', category: 'campaigns', label: 'Copy campaign', implemented: true, risk: 'high', fields: [
    { name: 'source_campaign_id', label: 'Source campaign ID', required: true },
    { name: 'new_name', label: 'New name', required: true },
    { name: 'budget_amount', label: 'New daily budget ($)', type: 'number' },
  ]},
  { ref: 'create_ad_schedule', toolId: 'google_create_ad_schedule', category: 'campaigns', label: 'Ad schedule', implemented: true, risk: 'high', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'schedules', label: 'Schedules (JSON array)', type: 'textarea', required: true, placeholder: '[{"day_of_week":"MONDAY","start_hour":8,"end_hour":18,"bid_modifier":1.2}]' },
  ]},
  { ref: 'get_campaign_overview', toolId: 'google_report_performance', category: 'campaigns', label: 'Campaign overview', implemented: true, risk: 'read', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID (optional)' },
    { name: 'date_range', label: 'Date range', type: 'select', options: [
      { value: 'LAST_7_DAYS', label: '7 days' }, { value: 'LAST_30_DAYS', label: '30 days' },
    ]},
  ]},

  // Budgets
  { ref: 'create_budget', toolId: 'google_create_budget', category: 'budgets', label: 'Create budget', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Budget name', required: true },
    { name: 'daily_budget', label: 'Daily amount ($)', type: 'number', required: true },
  ]},
  { ref: 'update_budget', toolId: 'google_update_budget', category: 'budgets', label: 'Update budget', implemented: true, risk: 'high', fields: [
    { name: 'budget_id', label: 'Budget ID', required: true },
    { name: 'daily_budget', label: 'New daily ($)', type: 'number' },
  ]},
  { ref: 'list_budgets', toolId: 'google_list_budgets', category: 'budgets', label: 'List budgets', implemented: true, risk: 'read', fields: [] },

  // Ad groups
  { ref: 'create_ad_group', toolId: 'google_create_adgroup', category: 'ad_groups', label: 'Create ad group', implemented: true, risk: 'high', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'name', label: 'Ad group name', required: true },
    { name: 'cpc_bid', label: 'Max CPC ($)', type: 'number' },
    { name: 'status', label: 'Status', type: 'select', options: [{ value: 'PAUSED', label: 'Paused' }, { value: 'ENABLED', label: 'Enabled' }] },
  ]},
  { ref: 'update_ad_group', toolId: 'google_update_adgroup', category: 'ad_groups', label: 'Update ad group', implemented: true, risk: 'medium', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'status', label: 'Status', type: 'select', required: true, options: [{ value: 'PAUSED', label: 'Paused' }, { value: 'ENABLED', label: 'Enabled' }] },
  ]},
  { ref: 'list_ad_groups', toolId: 'google_list_ad_groups', category: 'ad_groups', label: 'List ad groups', implemented: true, risk: 'read', fields: [{ name: 'platform_campaign_id', label: 'Campaign ID (filter)' }] },

  // Keywords
  { ref: 'add_keywords', toolId: 'google_add_keywords', category: 'keywords', label: 'Add keywords', implemented: true, risk: 'high', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'keywords', label: 'Keywords (text [MATCH])', type: 'textarea', required: true, hint: 'buy shoes [BROAD]' },
  ]},
  { ref: 'add_negative_keywords', toolId: 'google_add_negative_keywords', category: 'keywords', label: 'Campaign negatives', implemented: true, risk: 'medium', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'keywords', label: 'Negative keywords', type: 'textarea', required: true },
  ]},
  { ref: 'get_keyword_performance', toolId: 'google_report_keywords', category: 'keywords', label: 'Keyword performance', implemented: true, risk: 'read', fields: [
    { name: 'date_range', label: 'Date range', type: 'select', options: [{ value: 'LAST_30_DAYS', label: '30 days' }] },
  ]},
  { ref: 'update_keyword_bid', toolId: 'google_update_keyword_bid', category: 'keywords', label: 'Update keyword bid', implemented: true, risk: 'medium', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'keyword_id', label: 'Keyword criterion ID', required: true },
    { name: 'cpc_bid', label: 'CPC ($)', type: 'number', required: true },
  ]},
  { ref: 'pause_keyword', toolId: 'google_pause_keyword', category: 'keywords', label: 'Pause keyword', implemented: true, risk: 'medium', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'keyword_id', label: 'Keyword ID', required: true },
  ]},
  { ref: 'enable_keyword', toolId: 'google_enable_keyword', category: 'keywords', label: 'Enable keyword', implemented: true, risk: 'medium', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'keyword_id', label: 'Keyword ID', required: true },
  ]},
  { ref: 'delete_keyword', toolId: 'google_delete_keyword', category: 'keywords', label: 'Delete keyword', implemented: true, risk: 'high', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'keyword_id', label: 'Keyword ID', required: true },
  ]},
  { ref: 'list_keywords', toolId: 'google_list_keywords', category: 'keywords', label: 'List keywords', implemented: true, risk: 'read', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID (filter)' },
    { name: 'platform_ad_set_id', label: 'Ad group ID (filter)' },
  ]},

  // Ads
  { ref: 'create_responsive_search_ad', toolId: 'google_create_ad', category: 'ads', label: 'Create RSA', implemented: true, risk: 'high', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'final_url', label: 'Final URL', type: 'url', required: true },
    { name: 'headlines', label: 'Headlines', type: 'textarea', required: true },
    { name: 'descriptions', label: 'Descriptions', type: 'textarea', required: true },
    { name: 'path1', label: 'Path 1' },
    { name: 'path2', label: 'Path 2' },
  ]},
  { ref: 'create_expanded_text_ad', toolId: 'google_create_expanded_text_ad', category: 'ads', label: 'Expanded text ad (deprecated)', implemented: true, risk: 'high', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'headline1', label: 'Headline 1', required: true },
    { name: 'headline2', label: 'Headline 2', required: true },
    { name: 'headline3', label: 'Headline 3' },
    { name: 'description1', label: 'Description 1', required: true },
    { name: 'description2', label: 'Description 2' },
    { name: 'final_urls', label: 'Final URLs (JSON array or one URL)', required: true },
  ]},
  { ref: 'list_ads', toolId: 'google_list_ads_read', category: 'ads', label: 'List ads', implemented: true, risk: 'read', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID' },
    { name: 'platform_ad_set_id', label: 'Ad group ID' },
  ]},
  { ref: 'pause_ad', toolId: 'google_pause_ad', category: 'ads', label: 'Pause ad', implemented: true, risk: 'medium', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'platform_ad_id', label: 'Ad ID', required: true },
  ]},
  { ref: 'enable_ad', toolId: 'google_enable_ad', category: 'ads', label: 'Enable ad', implemented: true, risk: 'medium', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'platform_ad_id', label: 'Ad ID', required: true },
  ]},
  { ref: 'delete_ad', toolId: 'google_delete_ad', category: 'ads', label: 'Delete ad', implemented: true, risk: 'high', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'platform_ad_id', label: 'Ad ID', required: true },
  ]},
  { ref: 'get_ad_group', toolId: 'google_get_ad_group', category: 'ad_groups', label: 'Get ad group', implemented: true, risk: 'read', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
  ]},
  { ref: 'update_ad_group', toolId: 'google_update_adgroup_full', category: 'ad_groups', label: 'Update ad group (name/bid)', implemented: true, risk: 'medium', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'name', label: 'New name' },
    { name: 'cpc_bid', label: 'Max CPC ($)', type: 'number' },
  ]},

  // Targeting
  { ref: 'create_geo_targeting', toolId: 'google_create_geo_targeting', category: 'targeting', label: 'Add locations', implemented: true, risk: 'high', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'geo_ids', label: 'Geo IDs (comma)', required: true, hint: '2840=US, 2124=CA' },
  ]},
  { ref: 'search_geo_locations', toolId: 'google_search_geo_locations', category: 'targeting', label: 'Search geo by name', description: 'Resolve geo_target_constant_id from place name', implemented: true, risk: 'read', fields: [
    { name: 'query', label: 'Location name', required: true, placeholder: 'Morocco, California, …' },
    { name: 'country_code', label: 'Country code (optional)', placeholder: 'US' },
  ]},
  { ref: 'resolve_geo_targeting', toolId: 'google_resolve_geo_targeting', category: 'targeting', label: 'Resolve geo targeting', description: 'Resolve include/exclude locations from natural language', implemented: true, risk: 'read', fields: [
    { name: 'include', label: 'Include (JSON array)', placeholder: '[{"name":"Morocco","type":"country"}]' },
    { name: 'exclude', label: 'Exclude (JSON array)', placeholder: '[{"name":"Casablanca","type":"city","country_context":"MA"}]' },
  ]},
  { ref: 'add_language_targeting', toolId: 'google_add_language_targeting', category: 'targeting', label: 'Add languages', implemented: true, risk: 'medium', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'languages', label: 'Languages (comma)', placeholder: 'English, French' },
  ]},
  { ref: 'list_merchant_centers', toolId: 'google_list_merchant_centers', category: 'targeting', label: 'List Merchant Centers', description: 'Linked Merchant Center accounts for Shopping', implemented: true, risk: 'read', fields: [] },
  { ref: 'exclude_geo_targets', toolId: 'google_exclude_geo_targets', category: 'targeting', label: 'Exclude locations', implemented: true, risk: 'medium', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'geo_ids', label: 'Geo IDs to exclude', required: true },
  ]},
  { ref: 'update_campaign_geo_target', toolId: 'google_update_campaign_geo_target', category: 'targeting', label: 'Geo target mode', implemented: true, risk: 'medium', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'positive_geo_target_type', label: 'Positive', type: 'select', options: [
      { value: 'PRESENCE', label: 'Presence' }, { value: 'PRESENCE_OR_INTEREST', label: 'Presence or interest' },
    ]},
  ]},
  { ref: 'get_location_performance', toolId: 'google_get_location_performance', category: 'targeting', label: 'Location performance', implemented: true, risk: 'read', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID' },
    { name: 'date_range', label: 'Date range', type: 'select', options: [{ value: 'LAST_30_DAYS', label: '30d' }] },
  ]},

  // Extensions
  { ref: 'create_sitelink_extensions', toolId: 'google_create_sitelink_extensions', category: 'extensions', label: 'Sitelinks', implemented: true, risk: 'medium', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'sitelinks_json', label: 'Sitelinks JSON', type: 'textarea', required: true, hint: '[{"text":"Shop","url":"https://..."}]' },
  ]},
  { ref: 'create_callout_extensions', toolId: 'google_create_callout_extensions', category: 'extensions', label: 'Callouts', implemented: true, risk: 'medium', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'callouts', label: 'Callouts (one per line)', type: 'textarea', required: true },
  ]},
  { ref: 'create_structured_snippet_extensions', toolId: 'google_create_structured_snippet_extensions', category: 'extensions', label: 'Structured snippets', implemented: true, risk: 'medium', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'structured_snippets_json', label: 'JSON [{header, values[]}]', type: 'textarea', required: true },
  ]},
  { ref: 'create_call_extensions', toolId: 'google_create_call_extensions', category: 'extensions', label: 'Call extensions', implemented: true, risk: 'medium', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'phone_number', label: 'Phone', required: true },
    { name: 'country_code', label: 'Country', type: 'select', options: [{ value: 'US', label: 'US' }, { value: 'CA', label: 'CA' }] },
  ]},
  { ref: 'list_extensions', toolId: 'google_list_extensions', category: 'extensions', label: 'List extensions', implemented: true, risk: 'read', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID' },
  ]},
  { ref: 'delete_extension', toolId: 'google_delete_extension', category: 'extensions', label: 'Delete extension', implemented: true, risk: 'high', fields: [
    { name: 'resource_name', label: 'campaign_asset resource_name', required: true },
  ]},

  // Assets
  { ref: 'upload_image_asset', toolId: 'google_upload_image_asset', category: 'assets', label: 'Upload image', implemented: true, risk: 'medium', fields: [
    { name: 'name', label: 'Asset name', required: true },
    { name: 'image_data', label: 'Base64 image', type: 'textarea', required: true },
  ]},
  { ref: 'upload_text_asset', toolId: 'google_upload_text_asset', category: 'assets', label: 'Upload text asset', implemented: true, risk: 'low', fields: [
    { name: 'name', label: 'Name', required: true },
    { name: 'text', label: 'Text', required: true },
  ]},
  { ref: 'list_assets', toolId: 'google_list_assets', category: 'assets', label: 'List assets', implemented: true, risk: 'read', fields: [] },

  // Reporting
  { ref: 'get_account_summary', toolId: 'google_report_account_summary', category: 'reporting', label: 'Account summary', implemented: true, risk: 'read', fields: [
    { name: 'date_range', label: 'Range', type: 'select', options: [{ value: 'LAST_30_DAYS', label: '30d' }, { value: 'LAST_7_DAYS', label: '7d' }] },
  ]},
  { ref: 'get_campaign_performance', toolId: 'google_report_performance', category: 'reporting', label: 'Campaign performance', implemented: true, risk: 'read', fields: [{ name: 'date_range', label: 'Range', type: 'select', options: [{ value: 'LAST_30_DAYS', label: '30d' }] }] },
  { ref: 'get_ad_group_performance', toolId: 'google_report_ad_groups', category: 'reporting', label: 'Ad group performance', implemented: true, risk: 'read', fields: [] },
  { ref: 'get_search_terms_report', toolId: 'google_report_search_terms', category: 'reporting', label: 'Search terms', implemented: true, risk: 'read', fields: [] },
  { ref: 'run_gaql_query', toolId: 'google_report_gaql', category: 'reporting', label: 'GAQL query', implemented: true, risk: 'read', fields: [{ name: 'query', label: 'GAQL', type: 'textarea', required: true }] },
  { ref: 'identify_optimization_opportunities', toolId: 'google_report_optimization_hints', category: 'reporting', label: 'Optimization hints', implemented: true, risk: 'read', fields: [] },

  // Docs
  { ref: 'get_gaql_doc', toolId: 'google_docs_gaql', category: 'docs', label: 'GAQL docs', implemented: true, risk: 'read', fields: [] },
  { ref: 'get_reporting_view_doc', toolId: 'google_docs_reporting_views', category: 'docs', label: 'Reporting views', implemented: true, risk: 'read', fields: [] },
  { ref: 'get_reporting_fields_doc', toolId: 'google_docs_reporting_fields', category: 'docs', label: 'Field lookup', implemented: true, risk: 'read', fields: [{ name: 'fields', label: 'Fields (comma)', required: true }] },

  // Audiences / bidding
  { ref: 'create_custom_audience', toolId: 'google_create_custom_audience', category: 'audiences', label: 'Custom audience', implemented: true, risk: 'high', fields: [
    { name: 'name', label: 'Audience name', required: true },
    { name: 'audience_type', label: 'Type', type: 'select', options: [
      { value: 'WEBSITE_VISITORS', label: 'Website visitors' },
      { value: 'CUSTOMER_MATCH', label: 'Customer match' },
    ]},
    { name: 'rules', label: 'Rules (JSON)', type: 'textarea', placeholder: '{"url_contains":"/pricing"}' },
    { name: 'description', label: 'Description' },
  ]},
  { ref: 'list_audiences', toolId: 'google_list_audiences', category: 'audiences', label: 'List audiences', implemented: true, risk: 'read', fields: [] },
  { ref: 'add_audience_targeting', toolId: 'google_add_audience_targeting', category: 'audiences', label: 'Audience targeting', implemented: true, risk: 'high', fields: [
    { name: 'platform_ad_set_id', label: 'Ad group ID', required: true },
    { name: 'audience_id', label: 'Audience / user list ID', required: true },
    { name: 'bid_modifier', label: 'Bid modifier (e.g. 1.2)', type: 'number' },
  ]},
  { ref: 'set_bid_adjustments', toolId: 'google_set_bid_adjustments', category: 'bidding', label: 'Bid adjustments', implemented: true, risk: 'high', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'adjustments', label: 'Adjustments (JSON)', type: 'textarea', required: true, placeholder: '{"device":{"mobile":1.2},"location":{"2840":1.1}}' },
  ]},
  { ref: 'optimize_geographic_targeting', toolId: 'google_optimize_geographic_targeting', category: 'bidding', label: 'Geo optimization hints', implemented: true, risk: 'read', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID', required: true },
    { name: 'date_range', label: 'Date range', type: 'select', options: [{ value: 'LAST_30_DAYS', label: '30d' }] },
  ]},
  { ref: 'get_device_performance', toolId: 'google_get_device_performance', category: 'bidding', label: 'Device performance', implemented: true, risk: 'read', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID' },
    { name: 'date_range', label: 'Date range', type: 'select', options: [{ value: 'LAST_30_DAYS', label: '30d' }] },
  ]},
  { ref: 'list_bidding_strategies', toolId: 'google_list_bidding_strategies', category: 'bidding', label: 'Bidding strategies', implemented: true, risk: 'read', fields: [] },
  { ref: 'auto_suggest_negative_keywords', toolId: 'google_suggest_negative_keywords', category: 'intelligence', label: 'Suggest negatives', implemented: true, risk: 'read', fields: [
    { name: 'platform_campaign_id', label: 'Campaign ID' },
    { name: 'min_cost', label: 'Min spend ($)', type: 'number' },
  ]},
  { ref: 'get_recommendations', toolId: 'google_get_recommendations', category: 'advanced', label: 'Recommendations', implemented: true, risk: 'read', fields: [] },
  { ref: 'apply_recommendation', toolId: 'google_apply_recommendation', category: 'advanced', label: 'Apply recommendation', implemented: true, risk: 'high', fields: [
    { name: 'recommendation_resource_name', label: 'Recommendation RN', required: true },
  ]},
  { ref: 'get_change_history', toolId: 'google_get_change_history', category: 'advanced', label: 'Change history', implemented: true, risk: 'read', fields: [
    { name: 'date_range', label: 'Date range', type: 'select', options: [{ value: 'LAST_30_DAYS', label: '30d' }] },
  ]},
]

export function toolsByCategory(categoryId) {
  return GOOGLE_TOOLS.filter((t) => t.category === categoryId)
}

export function implementedTools() {
  return GOOGLE_TOOLS.filter((t) => t.implemented && t.toolId)
}

export function buildToolPayload(tool, formValues, context = {}) {
  const payload = { account_id: context.accountId }
  if (context.platformCampaignId) {
    payload.platform_campaign_id = context.platformCampaignId
    payload.campaign_id = context.platformCampaignId
  }
  if (context.platformAdSetId) {
    payload.platform_ad_set_id = context.platformAdSetId
    payload.ad_group_id = context.platformAdSetId
  }

  for (const [key, val] of Object.entries(formValues || {})) {
    if (val === '' || val == null) continue
    if (key === 'keywords' && typeof val === 'string') {
      const lines = val.split('\n').map((l) => l.trim()).filter(Boolean)
      if (tool.toolId === 'google_add_keywords') {
        payload.keyword_entries = lines.map((line) => {
          const m = line.match(/^(.+?)\s*\[(BROAD|PHRASE|EXACT)\]\s*$/i)
          return m
            ? { text: m[1].trim(), match_type: m[2].toUpperCase() }
            : { text: line, match_type: 'BROAD' }
        })
      } else {
        payload.keywords = lines
      }
      continue
    }
    if (key === 'headlines' || key === 'descriptions') {
      const lines = String(val).split('\n').map((l) => l.trim()).filter(Boolean)
      if (!payload.creatives) payload.creatives = {}
      payload.creatives[key] = lines
      if (key === 'headlines') payload.headlines = lines
      if (key === 'descriptions') payload.descriptions = lines
      continue
    }
    if (key === 'sitelinks_json') {
      try {
        payload.sitelinks = JSON.parse(val)
      } catch {
        payload.sitelinks = []
      }
      continue
    }
    if (key === 'structured_snippets_json') {
      try {
        payload.structured_snippets = JSON.parse(val)
      } catch {
        payload.structured_snippets = []
      }
      continue
    }
    if (key === 'callouts' && typeof val === 'string') {
      payload.callouts = val.split('\n').map((l) => l.trim()).filter(Boolean)
      continue
    }
    if (key === 'geo_ids') {
      payload.geo_target_constant_ids = String(val).split(/[\s,]+/).map(Number).filter(Number.isFinite)
      continue
    }
    if (key === 'daily_budget') {
      payload.daily_budget = parseFloat(val)
      continue
    }
    if (key === 'budget_amount') {
      payload.budget = { amount: parseFloat(val), currency: 'USD', type: 'daily' }
      payload.name = formValues.name || payload.name
      continue
    }
    if (key === 'cpc_bid') {
      payload.cpc_bid_micros = Math.round(parseFloat(val) * 1_000_000)
      continue
    }
    if (key === 'fields' && typeof val === 'string') {
      payload.fields = val.split(/[\s,]+/).map((f) => f.trim()).filter(Boolean)
      continue
    }
    if (key === 'final_url') {
      payload.final_url = val
      if (!payload.creatives) payload.creatives = {}
      payload.creatives.final_url = val
      payload.creatives.link_url = val
      continue
    }
    if (key === 'schedules' && typeof val === 'string') {
      try {
        payload.schedules = JSON.parse(val)
      } catch {
        payload.schedules = []
      }
      continue
    }
    if (key === 'adjustments' && typeof val === 'string') {
      try {
        payload.adjustments = JSON.parse(val)
      } catch {
        payload.adjustments = {}
      }
      continue
    }
    if (key === 'rules' && typeof val === 'string') {
      try {
        payload.rules = JSON.parse(val)
      } catch {
        payload.rules = { url_contains: val }
      }
      continue
    }
    if (key === 'final_urls') {
      try {
        const parsed = JSON.parse(val)
        payload.final_urls = Array.isArray(parsed) ? parsed : [val]
      } catch {
        payload.final_urls = String(val).split(/[\n,]+/).map((u) => u.trim()).filter(Boolean)
      }
      continue
    }
    payload[key] = val
  }

    const typedPublishTools = new Set([
      'google_publish_campaign',
      'google_publish_search_campaign',
      'google_publish_display_campaign',
      'google_publish_video_campaign',
      'google_publish_shopping_campaign',
      'google_publish_performance_max_campaign',
      'google_publish_app_campaign',
      'google_publish_local_campaign',
    ])
    if (typedPublishTools.has(tool.toolId)) {
      const rawType = formValues.type || formValues.campaign_type || 'search'
      payload.type = String(rawType).toLowerCase().replace(/^multi_channel$/, 'app')
      payload.adgroup_status = formValues.adgroup_status || 'PAUSED'
    }
    if (tool.toolId === 'google_create_campaign_with_budget' || tool.toolId === 'google_create_typed_campaign') {
      const ct = formValues.campaign_type || formValues.type || 'SEARCH'
      payload.campaign_type = String(ct).toUpperCase()
      payload.type = payload.campaign_type
    }

  return payload
}
