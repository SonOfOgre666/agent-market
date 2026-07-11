# Meta Ads: reference → production symbol map

This document maps **internal helpers, constants, and MCP tools** from `reference_ads/meta_ads/` to the agent-market production stack under `services/ai-worker/connectors/meta_ads/`.

Reference code is the Meta Ads MCP implementation (async, JSON-string returns, `@mcp_server.tool()`). Production code is **sync Graph connectors** (dict returns) plus **tool wrappers** in `services/ai-worker/tools/ads/meta/` registered as `meta_*` in `tools/ads/registry.py` and `registry/tools.json`.

---

## Layer diagram

```text
reference_ads/meta_ads/*.py
        │
        ├─► connectors/meta_ads/*.py     (Graph API + helpers; no MCP)
        │
        ├─► tools/ads/meta/*.py          (validate payload, call connector)
        │
        └─► POST /api/ads/tools/execute  (account_id → access_token enrichment)
```

---

## `reference_ads/meta_ads/ads.py` internals

Most creative logic in reference lives in one large file. Production **splits** it by responsibility.

### Constants and placement / enhancement helpers

| Reference symbol | Production file | Notes |
|------------------|-----------------|-------|
| `_PLACEMENT_GROUP_TO_POSITIONS` | `creative_helpers.py` | Maps placement groups → `publisher_platform` / `facebook_positions` / etc. |
| `_translate_asset_customization_rules` | `creative_helpers.py` | Image / carousel placement rules |
| `_ALL_ENHANCEMENT_KEYS` | `creative_helpers.py` | Advantage+ creative feature opt-out keys |
| `_strip_deprecated_standard_enhancements` | `creative_helpers.py` | Removes deprecated `standard_enhancements` |
| `_translate_video_customization_rules` | `creative_helpers.py` | Video placement rules (uploaded video) |
| `_translate_video_customization_rules_for_existing_post` | `creative_helpers.py` | Video rules for existing post creatives |
| `_normalize_text_variants` | `creative_helpers.py` | Headline / body / description variants |
| `extract_creative_image_urls` | `creative_helpers.py` | Was in reference `utils.py`; same traversal logic |

Used by `creative_mutations.py` (`create_ad_creative`, `update_ad_creative`).

### Image crop helpers

| Reference symbol | Production file | Notes |
|------------------|-----------------|-------|
| `_VALID_CROP_KEYS` | `image_crops.py` | Aspect presets for Meta `image_crops` |
| `_VALID_CROP_KEY_NAMES` | `image_crops.py` | |
| `_compute_crop_box` | `image_crops.py` | Center-crop math |
| `compute_image_crops` | `image_crops.py` | Public connector; tool `meta_compute_image_crops` |

### Creative mutation support

| Reference symbol | Production file | Notes |
|------------------|-----------------|-------|
| `_fetch_video_thumbnail` | `creative_mutations_support.py` | Sync; same fields as reference (`picture`, `thumbnails`) |
| `_discover_pages_for_account` | `creative_mutations_support.py` | Delegates to `pages.discover_pages_for_account` |
| `create_ad_creative` | `creative_mutations.py` | Structured port; imports helpers above |
| `update_ad_creative` | `creative_mutations.py` | |
| `_CREATIVE_DETAIL_FIELDS` | `creative_mutations.py` | Post-create fetch fields |

### Read / upload creatives (reference tools in same file)

| Reference symbol | Production file | Notes |
|------------------|-----------------|-------|
| `get_creative_details` | `creatives.get_creative_details` | |
| `get_ad_creatives` | `creatives.get_ad_creatives` | |
| `get_ad_image` | `creatives.get_ad_image` | Returns dict with URLs + `image_base64` (not MCP `Image`) |
| `get_ad_video` | `creatives.get_ad_video` | |
| `upload_ad_image` | `creatives.upload_ad_image` | |
| `CREATIVE_DETAIL_FIELDS` | `creatives.py` | |

### Ads CRUD (reference tools in same file)

| Reference symbol | Production file | Tool ID |
|------------------|-----------------|---------|
| `get_ads` | `ads.list_ads` | `meta_list_ads` |
| `get_ad_details` | `ads.get_ad_details` | `meta_get_ad` |
| `create_ad` | `ads.create_ad` | `meta_create_ad` |
| `update_ad` | `ads.update_ad` | `meta_update_ad` |

### Pages (reference tools at bottom of `ads.py`)

| Reference symbol | Production file | Tool ID |
|------------------|-----------------|---------|
| `_discover_pages_for_account` | `pages.discover_pages_for_account` | (internal) |
| `_search_pages_by_name_core` | `pages.search_pages_by_name` | `meta_search_pages_by_name` |
| `search_pages_by_name` | `pages.search_pages_by_name` | `meta_search_pages_by_name` |
| `get_account_pages` | `pages.get_account_pages` | `meta_get_account_pages` |
| `_PAGE_FIELDS`, `_collect_page_ids_from_ads`, `_fetch_page_details` | `pages.py` | Production-only helpers |

### Reference-only in `ads.py` (not ported)

| Symbol | Reason |
|--------|--------|
| `ENABLE_SAVE_AD_IMAGE_LOCALLY` | Env-gated; writes files to disk |
| `save_ad_image_locally` | Same |
| `@mcp_server.tool()` decorators | MCP transport only |
| `logger` | Standard logging; no port needed |

---

## `reference_ads/meta_ads/utils.py`

| Reference symbol | Production | Notes |
|------------------|------------|-------|
| `extract_creative_image_urls` | `creative_helpers.py` | See above |
| `download_image` | `creative_mutations_support._download_image_bytes` | Sync single-method download |
| `try_multiple_download_methods` | — | Not ported; simpler download path |
| `ad_creative_images` | — | MCP in-memory resource cache |
| `create_resource_from_image` | — | MCP `resources.py` only |
| `setup_logging` / `logger` | — | App logging |

---

## Other reference modules

### `api.py`

| Reference | Production |
|-----------|------------|
| `ensure_act_prefix` | `utils.ensure_act_prefix` |
| `make_api_request` | `api.graph_request` |
| `meta_api_tool` | — (MCP decorator) |
| `META_GRAPH_API_VERSION` | `api.DEFAULT_API_VERSION` (`v22.0` in prod vs `v24.0` in reference) |

### `accounts.py`

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `_ZERO_DECIMAL_CURRENCIES` | `accounts._ZERO_DECIMAL_CURRENCIES` | |
| `_cents_to_currency` | `accounts._cents_to_currency` | |
| `_normalize_account_monetary_fields` | `accounts._normalize_account_monetary_fields` | |
| `_DEFAULT_ACCOUNT_INFO_FIELDS` | `accounts._DEFAULT_ACCOUNT_INFO_FIELDS` | |
| `get_ad_accounts` | `accounts.list_ad_accounts` | `meta_get_ad_accounts` |
| `get_account_info` | `accounts.get_account_info` | `meta_get_account` |

Production also has `_map_picker_row`, `_EU_DSA_COUNTRIES`, `fetch_me_adaccounts` (workspace/UI helpers).

### `campaigns.py`

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `get_campaigns` | `campaigns.list_campaigns` | `meta_list_campaigns` |
| `get_campaign_details` | `campaigns.get_campaign_details` | `meta_get_campaign` |
| `create_campaign` | `campaigns.create_campaign` | `meta_create_campaign` |
| `update_campaign` | `campaigns.update_campaign` | `meta_update_campaign` |

### `adsets.py`

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `get_adsets` | `adsets.list_adsets` | `meta_list_adsets` |
| `get_adset_details` | `adsets.get_adset_details` | `meta_get_adset` |
| `create_adset` | `adsets.create_adset` | `meta_create_adset` |
| `update_adset` | `adsets.update_adset` | `meta_update_adset` |

Production adset helpers: `_STRATEGIES_REQUIRING_BID_AMOUNT`, `_prepare_targeting_reference`, `_validate_bid_strategy_create`, `_preflight_cbo_conflict`, etc. in `adsets.py`.

### `targeting.py`

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `search_interests` | `targeting_search.search_interests` | `meta_search_interests` |
| `get_interest_suggestions` | `targeting_search.get_interest_suggestions` | `meta_get_interest_suggestions` |
| `estimate_audience_size` | `targeting_search.estimate_audience_size` | `meta_estimate_audience_size` |
| `search_behaviors` | `targeting_search.search_behaviors` | `meta_search_behaviors` |
| `search_demographics` | `targeting_search.search_demographics` | `meta_search_demographics` |
| `search_geo_locations` | `targeting_search.search_geo_locations` | `meta_search_geo_locations` |

Note: `connectors/meta_ads/targeting.py` is **wizard default targeting** (`default_targeting`, `resolve_targeting`), not the MCP search tools.

### `insights.py`

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `_REDUNDANT_ACTION_PREFIXES` | `insights._REDUNDANT_ACTION_PREFIXES` | |
| `_BREAKDOWNS_INCOMPATIBLE_WITH_ACTION_TYPE` | `insights._BREAKDOWNS_INCOMPATIBLE_WITH_ACTION_TYPE` | |
| `_BREAKDOWNS_REQUIRING_EMPTY_ACTION_BREAKDOWNS` | `insights._BREAKDOWNS_REQUIRING_EMPTY_ACTION_BREAKDOWNS` | |
| `_ACTION_TYPED_FIELDS` | `insights._ACTION_TYPED_FIELDS` | |
| `_strip_redundant_actions` | `insights._strip_redundant_actions` | |
| `get_insights` | `insights.get_insights` | `meta_report_insights` |

Wrapper: `tools/ads/reporting/meta_insights.py`. Older/simpler paths may exist in `reporting.py` for legacy callers.

### `budget_schedules.py`

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `create_budget_schedule` | `budget_schedules.create_budget_schedule` | `meta_create_budget_schedule` |

### `duplication.py`

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `ENABLE_DUPLICATION` | `duplication.duplication_enabled()` | |
| `_forward_duplication_request` | `duplication._forward_duplication` | |
| `_get_estimated_components` | (inline in duplication flow) | |
| `duplicate_campaign` | `duplication.duplicate_campaign` | `meta_duplicate_campaign` |
| `duplicate_adset` | `duplication.duplicate_adset` | `meta_duplicate_adset` |
| `duplicate_ad` | `duplication.duplicate_ad` | `meta_duplicate_ad` |
| `duplicate_creative` | `duplication.duplicate_creative` | `meta_duplicate_creative` |

### `ads_library.py`

| Reference | Production | Tool ID |
|-----------|------------|---------|
| `DISABLE_ADS_LIBRARY` | `ads_library.ads_library_enabled()` | |
| `search_ads_archive` | `ads_library.search_ads_archive` | `meta_search_ads_library` |

---

## Production-only (no reference MCP tool)

| Symbol / tool | Location | Purpose |
|---------------|----------|---------|
| `meta_publish_campaign` | `tools/ads/meta/publish.py` + connectors | Wizard one-shot campaign publish |
| `publish_defaults.py` | `publish_defaults.py` | Wizard targeting / budget defaults |
| `_json_coerce.py` | `_json_coerce.py` | Coerce JSON-string params from LLM payloads |
| `create_link_creative` | `creatives.py` | Simpler creative path for publish wizard |
| `run_meta_ads_reporting` | `reporting.py` | Legacy reporting entry |

---

## MCP tools → registry `tool_id`

| Reference MCP function | Registry `tool_id` | Tool wrapper | Connector |
|------------------------|-------------------|--------------|-----------|
| `get_ad_accounts` | `meta_get_ad_accounts` | `tools/ads/meta/get_accounts.py` | `accounts.list_ad_accounts` |
| `get_account_info` | `meta_get_account` | `get_account.py` | `accounts.get_account_info` |
| `get_campaigns` | `meta_list_campaigns` | `list_campaigns.py` | `campaigns.list_campaigns` |
| `get_campaign_details` | `meta_get_campaign` | `get_campaign.py` | `campaigns.get_campaign_details` |
| `create_campaign` | `meta_create_campaign` | `create_campaign.py` | `campaigns.create_campaign` |
| `update_campaign` | `meta_update_campaign` | `update_campaign.py` | `campaigns.update_campaign` |
| `get_adsets` | `meta_list_adsets` | `list_adsets.py` | `adsets.list_adsets` |
| `get_adset_details` | `meta_get_adset` | `get_adset.py` | `adsets.get_adset_details` |
| `create_adset` | `meta_create_adset` | `create_adset.py` | `adsets.create_adset` |
| `update_adset` | `meta_update_adset` | `update_adset.py` | `adsets.update_adset` |
| `get_ads` | `meta_list_ads` | `list_ads.py` | `ads.list_ads` |
| `get_ad_details` | `meta_get_ad` | `get_ad.py` | `ads.get_ad_details` |
| `create_ad` | `meta_create_ad` | `create_ad.py` | `ads.create_ad` |
| `update_ad` | `meta_update_ad` | `update_ad.py` | `ads.update_ad` |
| `get_creative_details` | `meta_get_creative` | `get_creative.py` | `creatives.get_creative_details` |
| `get_ad_creatives` | `meta_get_ad_creatives` | `get_ad_creatives.py` | `creatives.get_ad_creatives` |
| `create_ad_creative` | `meta_create_creative` | `create_creative.py` | `creative_mutations.create_ad_creative` |
| `update_ad_creative` | `meta_update_creative` | `update_creative.py` | `creative_mutations.update_ad_creative` |
| `upload_ad_image` | `meta_upload_ad_image` | `upload_ad_image.py` | `creatives.upload_ad_image` |
| `compute_image_crops` | `meta_compute_image_crops` | `compute_image_crops.py` | `image_crops.compute_image_crops` |
| `get_ad_image` | `meta_get_ad_image` | `get_ad_image.py` | `creatives.get_ad_image` |
| `get_ad_video` | `meta_get_ad_video` | `get_ad_video.py` | `creatives.get_ad_video` |
| `get_account_pages` | `meta_get_account_pages` | `get_account_pages.py` | `pages.get_account_pages` |
| `search_pages_by_name` | `meta_search_pages_by_name` | `search_pages_by_name.py` | `pages.search_pages_by_name` |
| `search_interests` | `meta_search_interests` | `search_interests.py` | `targeting_search.search_interests` |
| `get_interest_suggestions` | `meta_get_interest_suggestions` | `get_interest_suggestions.py` | `targeting_search.get_interest_suggestions` |
| `estimate_audience_size` | `meta_estimate_audience_size` | `estimate_audience_size.py` | `targeting_search.estimate_audience_size` |
| `search_behaviors` | `meta_search_behaviors` | `search_behaviors.py` | `targeting_search.search_behaviors` |
| `search_demographics` | `meta_search_demographics` | `search_demographics.py` | `targeting_search.search_demographics` |
| `search_geo_locations` | `meta_search_geo_locations` | `search_geo_locations.py` | `targeting_search.search_geo_locations` |
| `create_budget_schedule` | `meta_create_budget_schedule` | `create_budget_schedule.py` | `budget_schedules.create_budget_schedule` |
| `duplicate_campaign` | `meta_duplicate_campaign` | `duplicate_campaign.py` | `duplication.duplicate_campaign` |
| `duplicate_adset` | `meta_duplicate_adset` | `duplicate_adset.py` | `duplication.duplicate_adset` |
| `duplicate_ad` | `meta_duplicate_ad` | `duplicate_ad.py` | `duplication.duplicate_ad` |
| `duplicate_creative` | `meta_duplicate_creative` | `duplicate_creative.py` | `duplication.duplicate_creative` |
| `search_ads_archive` | `meta_search_ads_library` | `search_ads_library.py` | `ads_library.search_ads_archive` |
| `get_insights` | `meta_report_insights` | `tools/ads/reporting/meta_insights.py` | `insights.get_insights` |
| — | `meta_publish_campaign` | `publish.py` | multiple connectors |

---

## Intentionally not ported

| Reference | Why |
|-----------|-----|
| `mcp_server`, `meta_api_tool`, stdio server | MCP transport |
| `auth.py`, `authentication.get_login_link`, `login` | OAuth via app `account_id` + stored tokens |
| `resources.list_resources` / `get_resource` | MCP resource protocol + `ad_creative_images` cache |
| `reports.generate_report` | Premium stub behind `META_ADS_ENABLE_REPORTS` |
| `save_ad_image_locally` | Local filesystem writes |
| `openai_deep_research.search` / `fetch` | OpenAI MCP-only |
| `bulk_get_insights` | Documented in reference README only; no implementation |

---

## Meta link-ad publish workflow (reference-aligned)

Meta requires **media** on every new link creative. `picture_url` alone is not enough — use `image_hash` from upload.

```text
1. meta_create_campaign          (OUTCOME_*, PAUSED, ABO budgets)
2. meta_create_adset             (targeting: geo_locations, optimization_goal, daily_budget)
3. meta_get_account_pages        → page_id
4. meta_upload_ad_image          → image_hash   ← was missing in UI one-shot publish
5. meta_create_creative          (image_hash, page_id, link_url, message, headline)
6. meta_create_ad                (adset_id, creative_id)
```

**One-shot:** `meta_publish_campaign` / `publish_campaign` runs 1→6; step 4 runs automatically when `creatives.image_url` is set and `image_hash` is absent.

**Alternatives (reference):** `object_story_id` (existing Page post), `video_id` / `videos[]`, `image_hashes` + placement rules, lead_gen_form_id (no link_url).

---

## Invoking from UI or agent

```http
POST /api/ads/tools/execute
Content-Type: application/json

{
  "tool_id": "meta_create_creative",
  "payload": {
    "account_id": "<connected Meta ad account Mongo id>",
    "name": "My creative",
    "page_id": "...",
    "image_hash": "..."
  }
}
```

Celery path: `tasks.ads.execute_ads_tool` with the same `tool_id` / `payload`. The API enriches `access_token` from the connected account record.

---

## Keeping this map current

When adding reference helpers from `reference_ads/meta_ads/ads.py`:

1. Prefer **`creative_helpers.py`** for placement, enhancements, text variants, URL extraction.
2. Prefer **`image_crops.py`** for crop math.
3. Prefer **`creative_mutations_support.py`** for small Graph side calls used only during create/update creative.
4. Wire **`creative_mutations.py`** and register a tool under `tools/ads/meta/` + `registry.py` / `tools.json`.

Update this file when you add or rename symbols.
