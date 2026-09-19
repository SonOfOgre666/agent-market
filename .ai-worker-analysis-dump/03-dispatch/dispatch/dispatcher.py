"""Registry dispatcher — sole runtime path for tool execution (§12, §34.3)."""

from __future__ import annotations

import logging
import re
from typing import Any

from celery_app import celery_app
from lib.dispatch.registry import get_tool, resolve_dispatch

logger = logging.getLogger(__name__)

_OBJECT_ID_RE = re.compile(r'^[a-f0-9]{24}$', re.I)

GEMINI_TASK = 'tasks.ai.gemini_sync'
CREATE_DRAFT_TASK = 'tasks.social.create_draft_post'
SCHEDULE_POST_TASK = 'tasks.social.schedule_post'
ADS_EXECUTE_TASK = 'tasks.ads.execute_ads_tool'
LANDING_PAGE_WORKFLOW_TASK = 'tasks.ads.run_landing_page_workflow'
SEO_CLUSTER_TASK = 'tasks.seo.cluster_keywords'
SEO_RANKS_TASK = 'tasks.seo.check_workspace_ranks'
SEO_AUDIT_TASK = 'tasks.seo.audit_landing_pages'
GENERATE_CAMPAIGN_ASSETS_TASK = 'tasks.generate_campaign_assets'
OPTIMIZE_CAMPAIGN_TASK = 'tasks.optimize_campaign'
BUDGET_PACING_TASK = 'tasks.ads.run_budget_pacing'
BUDGET_REALLOCATION_TASK = 'tasks.ads.run_budget_reallocation'
BID_OPTIMIZATION_TASK = 'tasks.ads.run_bid_optimization'
QUALITY_SCORE_TASK = 'tasks.ads.run_quality_score_monitor'
ASSET_AB_TASK = 'tasks.ads.run_asset_ab_analysis'


def dispatch_tool(tool_id: str, payload: dict[str, Any] | None = None) -> Any:
    """
    Execute a registry tool synchronously (used by workflow runtime).
    Async-only tools return a dispatch envelope without blocking.
    """
    spec = resolve_dispatch(tool_id)
    tool = get_tool(tool_id) or {}
    task_name = spec['task']
    body = payload or {}

    if task_name == GEMINI_TASK:
        from tasks.ai.gemini_sync import run_gemini_sync

        opcode = spec.get('opcode')
        if not opcode:
            raise ValueError(f'Tool {tool_id} missing opcode for {GEMINI_TASK}')
        agent_body = {**body, 'execution_source': body.get('execution_source') or 'agent'}
        return run_gemini_sync(opcode, agent_body)

    if task_name == CREATE_DRAFT_TASK:
        from tasks.social.create_draft_post import run_create_draft_post

        return run_create_draft_post(body)

    if task_name == SCHEDULE_POST_TASK:
        from tasks.social.schedule_post import run_schedule_post

        post_id = str(body.get('post_id') or '').strip()
        if not post_id:
            raise ValueError('schedule_post requires post_id in payload')
        if post_id.startswith('step_') or not _OBJECT_ID_RE.match(post_id):
            raise ValueError(
                'schedule_post requires a real post_id from create_draft_post — '
                f'got invalid value: {post_id!r}'
            )
        return run_schedule_post(body)

    if tool_id == 'publish_post':
        post_id = str(body.get('post_id') or '').strip()
        if not post_id:
            raise ValueError('publish_post requires post_id in payload')
        if post_id.startswith('step_') or not _OBJECT_ID_RE.match(post_id):
            raise ValueError(
                'publish_post requires a real post_id from create_draft_post — '
                f'got invalid value: {post_id!r}'
            )
        from lib import worker_api

        if worker_api.configured():
            worker_api.prepare_publish_post({
                'workspace_id': body.get('workspace_id'),
                'post_id': post_id,
                'account_ids': body.get('account_ids'),
                'platform': body.get('platform'),
            })
        celery_app.send_task(task_name, args=[post_id])
        return {'dispatched': True, 'task': task_name, 'post_id': str(post_id)}

    if tool_id == 'publish_campaign':
        campaign_id = body.get('campaign_id')
        if not campaign_id:
            raise ValueError('publish_campaign requires campaign_id in payload')
        celery_app.send_task(task_name, args=[str(campaign_id)])
        return {'dispatched': True, 'task': task_name, 'campaign_id': str(campaign_id)}

    if tool_id == 'import_account_metrics':
        # Agent path: sync + return snapshot (scheduler still uses Celery import_account).
        from tasks.imports.account_metrics_sync import run_import_account_metrics

        return run_import_account_metrics(body)

    if task_name == ADS_EXECUTE_TASK:
        from tasks.ads.execute_ads_tool import run_execute_ads_tool

        opcode = spec.get('opcode') or tool_id
        return run_execute_ads_tool(str(opcode), body)

    if task_name == LANDING_PAGE_WORKFLOW_TASK:
        from lib import worker_api

        if not worker_api.configured():
            raise RuntimeError('WORKER_API_SECRET not set')
        return worker_api.run_landing_page_workflow(body)

    if task_name == SEO_CLUSTER_TASK:
        from tasks.seo.cluster_keywords import run_cluster_seo_keywords

        return run_cluster_seo_keywords(body)

    if task_name == SEO_RANKS_TASK:
        from tasks.seo.check_workspace_ranks import run_check_workspace_ranks

        return run_check_workspace_ranks(body)

    if task_name == SEO_AUDIT_TASK:
        from tasks.seo.audit_landing_pages import run_audit_seo_landing_pages

        return run_audit_seo_landing_pages(body)

    if task_name == GENERATE_CAMPAIGN_ASSETS_TASK:
        from tasks.ads.campaign_content import run_generate_campaign_assets

        return run_generate_campaign_assets(body)

    if task_name == OPTIMIZE_CAMPAIGN_TASK:
        from tasks.ads.workspace_ops import run_optimize_campaign_tool

        return run_optimize_campaign_tool(body)

    if task_name == BUDGET_PACING_TASK:
        from tasks.ads.workspace_ops import run_budget_pacing

        return run_budget_pacing(body)

    if task_name == BUDGET_REALLOCATION_TASK:
        from tasks.ads.workspace_ops import run_budget_reallocation

        return run_budget_reallocation(body)

    if task_name == BID_OPTIMIZATION_TASK:
        from tasks.ads.workspace_ops import run_bid_optimization

        return run_bid_optimization(body)

    if task_name == QUALITY_SCORE_TASK:
        from tasks.ads.workspace_ops import run_quality_score_monitor

        return run_quality_score_monitor(body)

    if task_name == ASSET_AB_TASK:
        from tasks.ads.workspace_ops import run_asset_ab_analysis

        return run_asset_ab_analysis(body)

    raise ValueError(f'No dispatcher handler for tool_id={tool_id} task={task_name}')
