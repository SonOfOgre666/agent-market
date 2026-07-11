"""Campaign marketing content + optimization tasks (Celery)."""

from __future__ import annotations

import json
import logging
from typing import Optional

from celery_app import celery_app
from lib import worker_api
from lib.ads_marketing_content import (
    generate_campaign_search_assets,
    generate_landing_page_marketing_content,
)

from .._util import emit

logger = logging.getLogger(__name__)


def _write_reply(reply_key: Optional[str], body: dict) -> None:
    if not reply_key:
        return
    from db import get_redis

    ok = bool(body.get('ok', True))
    r = get_redis()
    r.set(
        reply_key,
        json.dumps(
            {
                'ok': ok,
                'data': body if ok else None,
                'error': body.get('error') if not ok else None,
                'status': 422 if not ok else 200,
            },
            default=str,
        ),
        ex=300,
    )


def run_generate_campaign_assets(body: dict) -> dict:
    """Sync entry for agent dispatcher — same logic as Celery task."""
    campaign_id = str(body.get('campaign_id') or '').strip()
    if not campaign_id:
        raise ValueError('campaign_id is required')
    if not worker_api.configured():
        raise RuntimeError('WORKER_API_SECRET not set')

    campaign_name = str(body.get('campaign_name') or body.get('name') or '').strip()
    keywords = body.get('keywords')
    workspace_id = body.get('workspace_id')

    if not campaign_name or keywords is None:
        snapshot = worker_api.get_ads_campaign_worker_snapshot(campaign_id)
        if not snapshot:
            raise ValueError(f'Campaign {campaign_id} not found')
        campaign_name = campaign_name or str(snapshot.get('name') or '').strip()
        if keywords is None:
            keywords = snapshot.get('keywords') or []
        workspace_id = workspace_id or snapshot.get('workspace_id')

    if not campaign_name:
        raise ValueError('campaign_name is required')

    language = str(body.get('language') or 'en')
    assets = generate_campaign_search_assets(
        campaign_name=campaign_name,
        keywords=keywords or [],
        workspace_id=workspace_id,
        language=language,
    )
    assets['ok'] = True
    worker_api.patch_campaign_assets(campaign_id, assets)
    try:
        worker_api.emit_event(
            'campaign.assets_generated',
            {'campaignId': campaign_id, 'assets': assets},
        )
    except Exception:
        emit('campaign.assets_generated', {'campaignId': campaign_id, 'assets': assets})
    return assets


@celery_app.task(name='tasks.generate_campaign_assets', bind=True, max_retries=0, acks_late=False)
def generate_campaign_assets(
    self,
    campaign_id: str,
    campaign_name: str,
    keywords: list,
    workspace_id: str | None = None,
    language: str = 'en',
    reply_key: Optional[str] = None,
):
    if not worker_api.configured() and reply_key:
        _write_reply(reply_key, {'ok': False, 'error': 'WORKER_API_SECRET not set'})
        return
    try:
        out = run_generate_campaign_assets({
            'campaign_id': campaign_id,
            'campaign_name': campaign_name,
            'keywords': keywords,
            'workspace_id': workspace_id,
            'language': language,
        })
        if reply_key:
            _write_reply(reply_key, out)
            return None
        logger.info(
            'Assets generated for campaign %s (source=%s)',
            campaign_id,
            out.get('source'),
        )
        return out
    except Exception as exc:
        logger.error('generate_campaign_assets failed for %s: %s', campaign_id, exc)
        if reply_key:
            _write_reply(reply_key, {'ok': False, 'error': str(exc)})
            return None
        raise


def run_optimize_campaign(campaign_id: str, options: dict | None = None) -> dict:
    """Shared optimization — delegates to API adsOptimization.runCampaignOptimization."""
    if not worker_api.configured():
        raise RuntimeError('WORKER_API_SECRET not set')
    return worker_api.run_campaign_optimization(campaign_id, options or {})


@celery_app.task(name='tasks.optimize_campaign', bind=True, max_retries=2)
def optimize_campaign(self, campaign_id: str, options: dict | None = None):
    if not worker_api.configured():
        logger.error('optimize_campaign: WORKER_API_SECRET not set')
        return
    try:
        result = run_optimize_campaign(campaign_id, options)
        suggestions = result.get('suggestions') or []
        logger.info('Campaign %s optimized (%d suggestions)', campaign_id, len(suggestions))
        return suggestions
    except Exception as exc:
        logger.error('optimize_campaign failed for %s: %s', campaign_id, exc)
        raise self.retry(exc=exc, countdown=120)


@celery_app.task(name='tasks.optimize_active_campaigns')
def optimize_active_campaigns():
    if not worker_api.configured():
        logger.warning('[Beat] optimize_active_campaigns skipped — WORKER_API_SECRET not set')
        return
    try:
        ids = worker_api.list_active_ads_campaign_ids()
    except Exception as exc:
        logger.exception('[Beat] list_active_ads_campaign_ids failed: %s', exc)
        return
    for cid in ids:
        optimize_campaign.delay(cid)
    logger.info('[Beat] Queued optimization for %d active campaign(s)', len(ids))


@celery_app.task(name='tasks.generate_landing_page_content', bind=True, max_retries=2)
def generate_landing_page_content(
    self,
    landing_page_id: str,
    campaign_name: str,
    workspace_id: str | None = None,
    keywords: list | None = None,
    language: str = 'en',
    reply_key: Optional[str] = None,
):
    if not worker_api.configured() and reply_key:
        _write_reply(reply_key, {'ok': False, 'error': 'WORKER_API_SECRET not set'})
        return
    try:
        content = generate_landing_page_marketing_content(
            campaign_name=campaign_name,
            workspace_id=workspace_id,
            keywords=keywords,
            language=language,
        )
        content['ok'] = True
        if worker_api.configured():
            worker_api.patch_landing_page_content(
                landing_page_id,
                headline=content['headline'],
                subheadline=content['subheadline'],
                body=content['body'],
                cta_text=content['cta_text'],
            )
            try:
                worker_api.emit_event(
                    'landing_page.content_generated',
                    {'landingPageId': landing_page_id, 'source': content.get('source')},
                )
            except Exception:
                emit('landing_page.content_generated', {'landingPageId': landing_page_id})
        if reply_key:
            _write_reply(reply_key, content)
            return None
        logger.info(
            'Landing page content generated for %s (source=%s)',
            landing_page_id,
            content.get('source'),
        )
        return content
    except Exception as exc:
        logger.error('generate_landing_page_content failed for %s: %s', landing_page_id, exc)
        if reply_key:
            _write_reply(reply_key, {'ok': False, 'error': str(exc)})
            return None
        raise self.retry(exc=exc, countdown=120)


@celery_app.task(name='tasks.ads.run_landing_page_workflow', bind=True, max_retries=2)
def run_landing_page_workflow(self, body: dict):
    """Agent tool: full landing page workflow via API internal route."""
    if not worker_api.configured():
        raise RuntimeError('WORKER_API_SECRET not set')
    try:
        return worker_api.run_landing_page_workflow(body or {})
    except Exception as exc:
        logger.error('run_landing_page_workflow failed: %s', exc)
        raise self.retry(exc=exc, countdown=60)
