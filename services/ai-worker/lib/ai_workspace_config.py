"""Workspace AI config — assignments from ai_workspace_configs only (no catalog model defaults)."""

from __future__ import annotations

from typing import Any, Optional

from lib import worker_api

OPCODE_TO_FEATURE = {
    'generate_post': 'post_generation',
    'generate_image': 'image_generation',
    'generate_video': 'video_generation',
    'generate_image_script': 'image_script',
    'generate_video_script': 'video_script',
    'generate_script': 'video_script',
    'analyze_comment': 'comment_analysis',
    'content_calendar_suggestions': 'content_calendar',
    'seo_keyword_clusters': 'google_search_marketing',
    'landing_page_plan': 'landing_page_copy',
}

ADS_MARKETING_FEATURES = frozenset({
    'google_search_marketing',
    'meta_ad_marketing',
    'landing_page_copy',
})

_catalog_cache: dict[str, Any] | None = None

_SETTINGS_HINT = (
    'Open Settings → AI Integrations: connect a provider (API key) and assign provider + model per feature.'
)


def _fetch_catalog() -> dict[str, Any]:
    global _catalog_cache
    if _catalog_cache:
        return _catalog_cache
    if not worker_api.configured():
        return {'views': {'defaults': {'features': {}}, 'planner_defaults': {}}}
    try:
        data = worker_api.get_ai_catalog()
        _catalog_cache = data if isinstance(data, dict) else {}
        return _catalog_cache
    except Exception:
        return {'views': {'defaults': {'features': {}}, 'planner_defaults': {}}}


def _fetch_workspace(workspace_id: Optional[str]) -> dict[str, Any]:
    if not worker_api.configured() or not workspace_id:
        return {'features': {}, 'planner': {}, 'catalog_views': {}}
    try:
        data = worker_api.get_ai_workspace_config(str(workspace_id))
        return data if isinstance(data, dict) else {'features': {}, 'planner': {}}
    except Exception:
        return {'features': {}, 'planner': {}}


def _require_row(provider: str, model: str, api_model_id: str, *, label: str) -> dict[str, str]:
    p = (provider or '').strip().lower()
    m = (model or '').strip()
    api = (api_model_id or m or '').strip()
    if not p or not m or not api:
        raise RuntimeError(f'{label} is not configured. {_SETTINGS_HINT}')
    return {'provider': p, 'model': m, 'api_model_id': api}


def get_planner_config(workspace_id: Optional[str]) -> dict[str, Any]:
    cfg = _fetch_workspace(workspace_id)
    planner = cfg.get('planner') or {}
    row = _require_row(
        planner.get('provider') or '',
        planner.get('model') or '',
        planner.get('api_model_id') or planner.get('model') or '',
        label='Marketing Assistant agent',
    )
    return {
        **row,
        'max_workflow_steps': int(planner.get('max_workflow_steps') or 10),
    }


def get_feature_assignment(workspace_id: Optional[str], feature_id: str) -> dict[str, str]:
    cfg = _fetch_workspace(workspace_id)
    row = (cfg.get('features') or {}).get(feature_id) or {}
    label = feature_id.replace('_', ' ')
    return _require_row(
        row.get('provider') or '',
        row.get('model') or '',
        row.get('api_model_id') or row.get('model') or '',
        label=f'AI feature "{label}"',
    )


def get_opcode_assignment(workspace_id: Optional[str], opcode: str) -> dict[str, str]:
    fid = OPCODE_TO_FEATURE.get(opcode)
    if not fid:
        raise ValueError(f'Unknown AI opcode: {opcode}')
    return get_feature_assignment(workspace_id, fid)


def get_ads_marketing_config(workspace_id: Optional[str], feature_id: str) -> dict[str, Any]:
    """Ads marketing LLM — dedicated feature first, then Marketing Assistant (planner)."""
    if feature_id not in ADS_MARKETING_FEATURES:
        raise ValueError(f'Unknown ads marketing feature: {feature_id}')
    try:
        row = get_feature_assignment(workspace_id, feature_id)
        return {**row, 'feature_id': feature_id}
    except Exception:
        planner = get_planner_config(workspace_id)
        return {**planner, 'feature_id': 'planner'}
