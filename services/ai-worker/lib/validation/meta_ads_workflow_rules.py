"""
Meta Ads execution constraints from meta_ads_guide.md.

Validation-only layer — does not change meta_* tool implementations.
Applied at workflow plan time (graph) and immediately before step dispatch (executor).
"""

from __future__ import annotations

from typing import Any

from connectors.meta_ads.publish_defaults import validate_publish_configuration
from lib.runtime.payload_resolve import _REF_RE

META_PIXEL_ADMIN = frozenset({'meta_create_ad_pixel', 'meta_update_ad_pixel'})
META_PIXEL_READ = frozenset({'meta_list_ad_pixels', 'meta_get_ad_pixel'})
META_GRANULAR_CREATE = frozenset({
    'meta_create_campaign',
    'meta_create_adset',
    'meta_create_creative',
    'meta_create_ad',
})
META_PUBLISH_ONE_SHOT = 'meta_publish_campaign'
META_MUTATING = frozenset({
    'meta_create_campaign',
    'meta_update_campaign',
    'meta_create_adset',
    'meta_update_adset',
    'meta_create_creative',
    'meta_update_creative',
    'meta_create_ad',
    'meta_update_ad',
    'meta_upload_ad_image',
    'meta_upload_ad_video',
    'meta_publish_campaign',
    'meta_create_budget_schedule',
    'meta_duplicate_campaign',
    'meta_duplicate_adset',
    'meta_duplicate_ad',
    'meta_duplicate_creative',
})
META_READ_BY_ENTITY: dict[str, frozenset[str]] = {
    'campaign': frozenset({'meta_list_campaigns', 'meta_get_campaign'}),
    'adset': frozenset({'meta_list_adsets', 'meta_get_adset'}),
    'ad': frozenset({'meta_list_ads', 'meta_get_ad'}),
    'creative': frozenset({'meta_get_creative', 'meta_get_ad_creatives'}),
}
META_UPDATE_TOOLS: dict[str, tuple[str, ...]] = {
    'meta_update_campaign': ('campaign_id', 'platform_campaign_id'),
    'meta_update_adset': ('adset_id', 'platform_ad_set_id', 'ad_set_id'),
    'meta_update_ad': ('ad_id', 'platform_ad_id'),
    'meta_update_creative': ('creative_id', 'platform_creative_id'),
}
_SALES_GOALS = frozenset({'OFFSITE_CONVERSIONS', 'VALUE'})
_OBJECTIVE_ALIASES = {
    'traffic': 'OUTCOME_TRAFFIC',
    'awareness': 'OUTCOME_AWARENESS',
    'engagement': 'OUTCOME_ENGAGEMENT',
    'leads': 'OUTCOME_LEADS',
    'sales': 'OUTCOME_SALES',
}


def _is_step_ref(val: Any) -> bool:
    return isinstance(val, str) and bool(_REF_RE.match(val.strip()))


def _norm_objective(raw: Any) -> str:
    s = str(raw or '').strip()
    if not s:
        return ''
    return _OBJECTIVE_ALIASES.get(s.lower(), s.upper())


def _optimization_goal(payload: dict[str, Any]) -> str:
    targeting = payload.get('targeting') if isinstance(payload.get('targeting'), dict) else {}
    return str(
        payload.get('optimization_goal')
        or targeting.get('optimization_goal')
        or ''
    ).strip().upper()


def _pixel_id_in_payload(payload: dict[str, Any]) -> bool:
    for src in (payload, payload.get('targeting') or {}, payload.get('creatives') or {}):
        if isinstance(src, dict) and str(src.get('pixel_id') or '').strip():
            return True
    return False


def _sales_conversion_payload(payload: dict[str, Any]) -> bool:
    obj = _norm_objective(payload.get('objective') or payload.get('campaign_objective'))
    og = _optimization_goal(payload)
    return obj == 'OUTCOME_SALES' and og in _SALES_GOALS


def _tools_before(steps: list[dict[str, Any]], index: int) -> list[str]:
    return [str(s.get('tool_id') or '') for s in steps[:index]]


def _workflow_has_meta_tools(steps: list[dict[str, Any]]) -> bool:
    return any(str(s.get('tool_id') or '').startswith('meta_') for s in steps)


def _update_entity(tool_id: str) -> str:
    if tool_id == 'meta_update_campaign':
        return 'campaign'
    if tool_id == 'meta_update_adset':
        return 'adset'
    if tool_id == 'meta_update_ad':
        return 'ad'
    return 'creative'


def _literal_id_in_payload(payload: dict[str, Any], keys: tuple[str, ...]) -> bool:
    for key in keys:
        val = payload.get(key)
        if val is None or val == '':
            continue
        if _is_step_ref(val):
            continue
        if str(val).strip():
            return True
    return False


def _campaign_dependency_satisfied(payload: dict[str, Any], before: list[str]) -> bool:
    cid = payload.get('campaign_id') or payload.get('platform_campaign_id')
    if _is_step_ref(cid):
        return True
    if 'meta_create_campaign' in before:
        return True
    if any(t in META_READ_BY_ENTITY['campaign'] for t in before):
        return True
    return False


def _creative_dependency_satisfied(payload: dict[str, Any], before: list[str]) -> bool:
    cid = payload.get('creative_id') or payload.get('platform_creative_id')
    if _is_step_ref(cid):
        return True
    if any(t in ('meta_create_creative', 'meta_get_ad_creatives') for t in before):
        return True
    return False


def _adset_dependency_satisfied(payload: dict[str, Any], before: list[str]) -> bool:
    aid = payload.get('adset_id') or payload.get('platform_ad_set_id') or payload.get('ad_set_id')
    if _is_step_ref(aid):
        return True
    if 'meta_create_adset' in before:
        return True
    if any(t in META_READ_BY_ENTITY['adset'] for t in before):
        return True
    return False


def _pixel_list_rule_satisfied(payload: dict[str, Any], before: list[str]) -> bool:
    if _pixel_id_in_payload(payload):
        return True
    return any(t in META_PIXEL_READ for t in before)


def _publish_config_error(tool_id: str, payload: dict[str, Any]) -> str | None:
    obj = _norm_objective(payload.get('objective') or payload.get('campaign_objective'))
    if not obj and tool_id == 'meta_create_adset':
        obj = 'OUTCOME_TRAFFIC'
    og = _optimization_goal(payload) or 'LINK_CLICKS'
    targeting = payload.get('targeting') if isinstance(payload.get('targeting'), dict) else {}
    creatives = payload.get('creatives') if isinstance(payload.get('creatives'), dict) else {}
    pixel_id = ''
    for src in (payload, targeting, creatives):
        if isinstance(src, dict):
            pixel_id = str(src.get('pixel_id') or '').strip()
            if pixel_id:
                break
    page_id = str(payload.get('page_id') or creatives.get('page_id') or '').strip()
    lead_form = str(payload.get('lead_gen_form_id') or creatives.get('lead_gen_form_id') or '').strip()
    app_id = str(payload.get('application_id') or targeting.get('application_id') or '').strip()
    store_url = str(payload.get('object_store_url') or targeting.get('object_store_url') or '').strip()
    has_video = bool(
        payload.get('video_id')
        or payload.get('video_url')
        or creatives.get('video_id')
        or creatives.get('video_url')
    )
    return validate_publish_configuration(
        obj,
        og,
        page_id=page_id or None,
        lead_gen_form_id=lead_form or None,
        pixel_id=pixel_id or None,
        application_id=app_id or None,
        object_store_url=store_url or None,
        has_video=has_video,
    )


def validate_meta_ads_workflow_graph(
    steps: list[dict[str, Any]],
    *,
    intent: str,
) -> None:
    """Raise ValueError when a planned workflow violates meta_ads_guide.md rules."""
    if not _workflow_has_meta_tools(steps):
        return

    tool_ids = [str(s.get('tool_id') or '') for s in steps]

    for tid in tool_ids:
        if tid in META_PIXEL_ADMIN:
            raise ValueError(
                f'{tid} is admin/setup only — not allowed in agent workflows (guide §4.3). '
                'Use meta_list_ad_pixels / meta_get_ad_pixel for campaign execution.'
            )

    has_publish = META_PUBLISH_ONE_SHOT in tool_ids
    has_granular = any(t in META_GRANULAR_CREATE for t in tool_ids)
    if has_publish and has_granular:
        raise ValueError(
            'Do not mix meta_publish_campaign with granular meta_create_* steps in one workflow (guide §4.1).'
        )

    if intent == 'analytics':
        past_insights = False
        for tid in tool_ids:
            if tid == 'meta_report_insights':
                past_insights = True
            elif past_insights and tid in META_MUTATING:
                raise ValueError(
                    'Reporting workflows must not include mutating Meta tools after meta_report_insights (guide §13).'
                )

    for i, step in enumerate(steps):
        tool_id = str(step.get('tool_id') or '')
        if not tool_id.startswith('meta_'):
            continue
        payload = step.get('payload') if isinstance(step.get('payload'), dict) else {}
        before = _tools_before(steps, i)

        if tool_id in ('meta_create_adset', META_PUBLISH_ONE_SHOT) and _sales_conversion_payload(payload):
            if not _pixel_list_rule_satisfied(payload, before):
                raise ValueError(
                    'OUTCOME_SALES conversion workflows require meta_list_ad_pixels (or pixel_id in payload) '
                    'before ad set / publish steps (guide §4.3).'
                )

        if tool_id == 'meta_create_adset' and not _campaign_dependency_satisfied(payload, before):
            raise ValueError(
                'meta_create_adset requires campaign_id from meta_create_campaign or meta_list/get campaign (guide §4.2).'
            )

        if tool_id == 'meta_create_ad' and not _creative_dependency_satisfied(payload, before):
            raise ValueError(
                'meta_create_ad requires a prior meta_create_creative or meta_get_ad_creatives step (guide §4.2).'
            )

        if tool_id == 'meta_create_ad' and not _adset_dependency_satisfied(payload, before):
            raise ValueError(
                'meta_create_ad requires adset_id from meta_create_adset or meta_list/get ad set (guide §4.2).'
            )

        if tool_id in META_UPDATE_TOOLS:
            keys = META_UPDATE_TOOLS[tool_id]
            entity = _update_entity(tool_id)
            if _literal_id_in_payload(payload, keys) and not any(
                t in META_READ_BY_ENTITY[entity] for t in before
            ):
                raise ValueError(
                    f'{tool_id} on existing objects requires prior meta_list_* or meta_get_* (guide §1.4).'
                )

        if tool_id in ('meta_create_adset', META_PUBLISH_ONE_SHOT):
            cfg_err = _publish_config_error(tool_id, payload)
            if cfg_err:
                raise ValueError(cfg_err)


def validate_meta_ads_step_execution(
    tool_id: str,
    payload: dict[str, Any],
    *,
    workflow_steps: list[dict[str, Any]],
    step_id: str,
    completed_step_results: dict[str, Any],
    intent: str = '',
) -> None:
    """Raise ValueError before dispatch when runtime state violates guide rules."""
    if not tool_id.startswith('meta_'):
        return

    if tool_id in META_PIXEL_ADMIN:
        raise ValueError(f'{tool_id} is not allowed in workflow execution (guide §4.3).')

    completed_tools: list[str] = []
    step_index = 0
    for i, step in enumerate(workflow_steps):
        sid = str(step.get('step_id') or '')
        if sid == step_id:
            step_index = i
            break
        row = completed_step_results.get(sid) or {}
        if row.get('status') == 'completed':
            completed_tools.append(str(step.get('tool_id') or ''))

    before = _tools_before(workflow_steps, step_index)
    # Include completed tools from earlier steps (may match before)
    for t in completed_tools:
        if t not in before:
            before.append(t)

    if tool_id in ('meta_create_adset', META_PUBLISH_ONE_SHOT) and _sales_conversion_payload(payload):
        resolved_pixel = _pixel_id_in_payload(payload)
        listed = any(t in META_PIXEL_READ for t in before)
        if not resolved_pixel and not listed:
            raise ValueError(
                'Sales conversion step requires pixel_id or a completed meta_list_ad_pixels step (guide §4.3).'
            )

    if tool_id in ('meta_create_adset', META_PUBLISH_ONE_SHOT):
        cfg_err = _publish_config_error(tool_id, payload)
        if cfg_err:
            raise ValueError(cfg_err)

    if tool_id in META_UPDATE_TOOLS:
        keys = META_UPDATE_TOOLS[tool_id]
        entity = _update_entity(tool_id)
        if _literal_id_in_payload(payload, keys) and not any(
            t in META_READ_BY_ENTITY[entity] for t in before
        ):
            raise ValueError(
                f'{tool_id}: re-validate with meta_list_* or meta_get_* before mutating (guide §1.4).'
            )

    # Re-apply graph-level rules for this step in case payload was resolved from upstream outputs.
    validate_meta_ads_workflow_graph(
        workflow_steps[: step_index + 1],
        intent=intent or 'ads_campaign',
    )
