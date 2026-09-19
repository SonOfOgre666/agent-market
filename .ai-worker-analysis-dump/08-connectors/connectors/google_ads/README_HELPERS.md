# Google Ads: reference → production symbol map

Maps **MCP tools** from `reference_ads/google_ads/` to the agent-market production stack under `services/ai-worker/connectors/google_ads/` and `services/ai-worker/tools/ads/google/`.

Reference code is the Google Ads MCP (sync tools, `ads_mcp` imports). Production code uses **sync connectors** returning `{ok, ...}` dicts plus **tool wrappers** registered as `google_*` in `tools/ads/registry.py` and `registry/tools.json`.

---

## Layer diagram

```text
reference_ads/google_ads/tools/**/*.py
        │
        ├─► connectors/google_ads/*.py     (Google Ads API SDK)
        │
        ├─► tools/ads/google/*.py          (validate payload, call connector)
        │
        └─► POST /api/ads/tools/execute    (account_id → google_ads_client_config)
```

---

## Mutations (`reference_ads/google_ads/tools/mutations/`)

| Reference tool | Production connector | Tool ID |
|----------------|---------------------|---------|
| `budget.create_campaign_budget` | `budgets.create_campaign_budget` | `google_create_budget` |
| `campaign.create_search_campaign` | `campaigns.create_search_campaign` | `google_create_search_campaign` |
| `campaign.update_campaign_status` | `campaigns.update_campaign_status` | `google_update_campaign` |
| `campaign.update_campaign_geo_target_type` | `campaigns.update_campaign_geo_target_type` | `google_update_campaign_geo_target` |
| `ad_group.create_ad_group` | `adgroups.create_ad_group` | `google_create_adgroup` |
| `ad_group.update_ad_group_status` | `adgroups.update_ad_group_status` | `google_update_adgroup` |
| `criterion.create_keywords` | `keywords.add_keywords_to_ad_group` (+ `keyword_entries`) | `google_add_keywords` |
| `criterion.create_negative_campaign_keywords` | `criteria.create_negative_campaign_keywords` | `google_add_negative_keywords` |
| `criterion.create_geo_targeting` | `criteria.create_geo_targeting` | `google_create_geo_targeting` |
| `criterion.exclude_geo_targets` | `criteria.exclude_geo_targets` | `google_exclude_geo_targets` |
| `criterion.remove_campaign_criterion` | `criteria.remove_campaign_criterion` | `google_remove_campaign_criterion` |
| `ad.create_responsive_search_ad` | `ads.create_responsive_search_ad` (+ `path1`, `path2`) | `google_create_ad` |

### Publish chain (production-only orchestration)

| Production tool | Notes |
|-----------------|-------|
| `google_create_campaign` | Budget + campaign + ad group + keywords + RSA in one call (`campaigns.mutate_create_paused_campaign`) |
| `google_publish_campaign` | Same as `google_create_campaign` (meta_publish_campaign parity for planner/UI) |
| `publish_campaign` task | Mongo draft → `google_create_campaign` |

---

## Reporting (`reference_ads/google_ads/tools/reporting.py`)

| Reference | Production | Tool ID |
|-----------|------------|---------|
| GAQL search | `reporting.run_google_ads_reporting` | `google_report_gaql` |
| Performance views | `tools/ads/reporting/google_*.py` | `google_report_performance`, `google_report_ad_groups`, … |

---

## Accounts & list reads

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `accounts.list_accessible_accounts` | `accounts.fetch_accessible_accounts` | `google_get_ad_accounts` |
| `accounts.get_account_info` | `accounts.fetch_customer_info` | `google_get_account` |
| (sync GAQL) | `campaigns.fetch_campaign_sync_rows` / `list_campaigns` | `google_list_campaigns` |
| get campaign | `campaigns.get_campaign` | `google_get_campaign` |
| list ad groups | `adgroups.list_ad_groups` | `google_list_ad_groups` |

---

## Documentation (`reference_ads/google_ads/tools/docs.py`)

| Reference tool | Production connector | Tool ID |
|----------------|---------------------|---------|
| `get_gaql_doc` | `docs.get_gaql_doc` | `google_docs_gaql` |
| `get_reporting_view_doc` | `docs.get_reporting_views_doc` | `google_docs_reporting_views` |
| `get_reporting_fields_doc` | `docs.get_reporting_fields_doc` | `google_docs_reporting_fields` |

## UI (workflow + performance)

| Component | Maps to |
|-----------|---------|
| `googleAdsWorkflow.js` | Single payload builder + review sections per `tool_id` |
| `googleInsightsUi.js` + `GoogleInsightsPanel.js` | Report view picker → `google_report_*` (agent uses same tools) |
| `googleAdsTools.js` | `runGoogleTool`, profile/campaign/ad group helpers |
| `GoogleTargetingFields.js` | `geo_target_constant_ids`, `excluded_geo_target_constant_ids`, `positive_geo_target_type`, `negative_geo_target_type`, `negative_keywords` → `keywords` |
| `GoogleKeywordFields.js` | `keyword_entries` → publish / `google_add_keywords` |
| `GoogleAdGroupFields.js` | `adgroup_status`, `cpc_bid_micros` |
| `GoogleAdCreativeFields.js` | `path1`, `path2`, `ad_status` |
| `GoogleReviewSummary.js` | Review step grouped by registry tool_id |
| `GoogleGaqlFieldLookup.js` | `google_docs_reporting_fields` on Performance page |

## Audiences, schedules, bid adjustments (`tools_audiences.py`, `tools_campaigns.py`, `tools_bidding.py`)

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `create_ad_schedule` | `campaigns.create_ad_schedule` | `google_create_ad_schedule` |
| `create_expanded_text_ad` | `ads.create_expanded_text_ad` | `google_create_expanded_text_ad` |
| `create_custom_audience` | `audiences.create_custom_audience` | `google_create_custom_audience` |
| `list_audiences` | `audiences.list_audiences` | `google_list_audiences` |
| `add_audience_targeting` | `audiences.add_audience_targeting` | `google_add_audience_targeting` |
| `set_bid_adjustments` | `bidding.set_bid_adjustments` | `google_set_bid_adjustments` |
| `optimize_geographic_targeting` | `geography.optimize_geographic_targeting` | `google_optimize_geographic_targeting` |

## Not ported (reference only)

| Reference | Reason |
|-----------|--------|
| `fields.yaml` (static bundle) | Optional; runtime lookup uses GAQL schema API when missing |
| `scripts/generate_views.py` | Doc generation only |
| MCP coordinator / `_get_client(login_customer_id)` | Replaced by `load_client(google_ads_client_config)` + API `enrichAdsToolPayload` |
| `get_bid_adjustment_performance`, full `update_ad` RSA edit | Lower priority; use GAQL + `google_update_ad` partial |

---

## UI

| Meta pattern | Google equivalent |
|--------------|-------------------|
| `apps/web/lib/metaAdsTools.js` | `apps/web/lib/googleAdsTools.js` |
| `runMetaTool` | `runGoogleTool` |

Both call `api.executeAdsTool` → `POST /api/ads/tools/execute`.
