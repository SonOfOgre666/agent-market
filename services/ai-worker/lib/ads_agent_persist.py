"""Persist agent-published ad campaigns to the local ads_campaigns collection."""

from __future__ import annotations

import logging
from typing import Any

from lib import worker_api

logger = logging.getLogger(__name__)

_GOOGLE_PUBLISH_PREFIX = 'google_publish_'
_META_PUBLISH_TOOLS = frozenset({'meta_publish_campaign', 'meta_create_campaign'})


def _local_status(raw: str | None) -> str:
    value = (raw or 'PAUSED').upper()
    if value == 'ENABLED':
        return 'active'
    if value == 'ENDED':
        return 'ended'
    return 'paused'


def _find_publish_output(graph: dict[str, Any], step_results: dict[str, Any]) -> dict[str, Any] | None:
    for step in graph.get('steps') or []:
        tool_id = str(step.get('tool_id') or '')
        if not (
            tool_id.startswith(_GOOGLE_PUBLISH_PREFIX)
            or tool_id in _META_PUBLISH_TOOLS
        ):
            continue
        sid = str(step.get('step_id') or '')
        row = step_results.get(sid) or {}
        if row.get('status') != 'completed':
            continue
        output = row.get('output') or {}
        platform_campaign_id = (
            output.get('platform_campaign_id')
            or output.get('id')
            or output.get('campaign_id')
        )
        if output.get('ok') and platform_campaign_id:
            return {
                'tool_id': tool_id,
                'platform_campaign_id': str(platform_campaign_id),
                'platform_ad_set_id': output.get('platform_ad_set_id'),
                'platform_ad_id': output.get('platform_ad_id'),
            }
    return None


def _google_payload(
    *,
    workspace_id: str,
    account_id: str | None,
    compiled: Any,
    publish: dict[str, Any],
) -> dict[str, Any]:
    keywords = list(compiled.keywords or [])
    targeting: dict[str, Any] = {}
    if compiled.geo_target_constant_ids:
        targeting['geo_target_constant_ids'] = list(compiled.geo_target_constant_ids)
    if compiled.geo_countries:
        targeting['geo_countries'] = list(compiled.geo_countries)
    if compiled.geo_intent is not None:
        targeting['geo_intent'] = compiled.geo_intent.to_payload()
    if keywords:
        match_type = str(compiled.keyword_match_type or 'BROAD').upper()
        targeting['keyword_entries'] = [
            {'text': kw, 'match_type': match_type} for kw in keywords
        ]

    creatives: dict[str, Any] = {}
    if compiled.final_url:
        creatives['final_url'] = compiled.final_url
        creatives['link_url'] = compiled.final_url
    if compiled.headlines:
        creatives['headlines'] = list(compiled.headlines)
    if compiled.descriptions:
        creatives['descriptions'] = list(compiled.descriptions)
    if compiled.business_name:
        creatives['business_name'] = compiled.business_name

    return {
        'workspace_id': workspace_id,
        'account_id': account_id,
        'platform': 'google_ads',
        'name': compiled.name,
        'type': compiled.campaign_type,
        'status': _local_status(compiled.status),
        'budget': {
            'amount': float(compiled.budget_amount or 0),
            'currency': compiled.currency or 'USD',
            'type': 'daily',
        },
        'start_date': compiled.start_date,
        'end_date': compiled.end_date,
        'keywords': keywords,
        'targeting': targeting,
        'creatives': creatives,
        'platform_campaign_id': publish['platform_campaign_id'],
        'platform_ad_set_id': publish.get('platform_ad_set_id'),
        'platform_ad_id': publish.get('platform_ad_id'),
    }


def persist_agent_campaign_from_workflow(
    *,
    workspace_id: str,
    graph: dict[str, Any],
    step_results: dict[str, Any],
    account_id: str | None = None,
) -> dict[str, Any] | None:
    """Create or update local ads_campaigns after a successful agent publish workflow."""
    if not worker_api.configured():
        return None

    publish = _find_publish_output(graph, step_results)
    if not publish:
        return None

    account_id = (
        account_id
        or graph.get('google_account_id')
        or graph.get('meta_account_id')
    )

    body: dict[str, Any] | None = None
    if graph.get('google_compiled'):
        from lib.planner.google_campaign_spec import compiled_from_graph

        compiled = compiled_from_graph(graph)
        if compiled:
            body = _google_payload(
                workspace_id=workspace_id,
                account_id=str(account_id) if account_id else None,
                compiled=compiled,
                publish=publish,
            )

    if body is None:
        return None

    try:
        result = worker_api.persist_agent_published_campaign(body)
        logger.info(
            '[ads_agent_persist] workspace=%s platform_campaign_id=%s created=%s',
            workspace_id,
            body.get('platform_campaign_id'),
            result.get('created'),
        )
        return result
    except Exception as exc:
        logger.exception('[ads_agent_persist] failed: %s', exc)
        return None
