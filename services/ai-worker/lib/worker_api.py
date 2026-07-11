"""HTTP client for apps/api internal worker routes (DB truth stays in API)."""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)


def _base() -> str:
    return (os.getenv('INTERNAL_API_URL') or 'http://127.0.0.1:4010').rstrip('/')


def _secret() -> str:
    return (os.getenv('WORKER_API_SECRET') or '').strip()


def _headers() -> Dict[str, str]:
    return {'X-Worker-Secret': _secret(), 'Content-Type': 'application/json'}


def configured() -> bool:
    return len(_secret()) >= 8


def get_publish_bundle(post_id: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/post-publish-bundle/{post_id}'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    return r.json()


def patch_post(post_id: str, fields: Dict[str, Any]) -> None:
    url = f'{_base()}/api/internal/worker/posts/{post_id}'
    r = httpx.patch(url, headers=_headers(), json=fields, timeout=60.0)
    r.raise_for_status()


def upsert_post_account(
    post_id: str,
    account_id: str,
    *,
    provider_post_id: Optional[str] = None,
    data: Optional[Dict[str, Any]] = None,
    errors: Optional[List[Any]] = None,
) -> None:
    url = f'{_base()}/api/internal/worker/post-accounts'
    body = {
        'post_id': str(post_id),
        'account_id': str(account_id),
        'provider_post_id': provider_post_id,
        'data': data or {},
        'errors': errors or [],
    }
    r = httpx.put(url, headers=_headers(), json=body, timeout=60.0)
    r.raise_for_status()


def patch_account_deauthorized(account_id: str) -> None:
    url = f'{_base()}/api/internal/worker/accounts/{account_id}/deauthorize'
    # Fastify rejects Content-Type: application/json with an empty body.
    r = httpx.patch(url, headers=_headers(), json={}, timeout=30.0)
    r.raise_for_status()


def emit_event(event: str, payload: Optional[Dict[str, Any]] = None) -> None:
    url = f'{_base()}/api/internal/worker/events'
    body = {'event': event, **(payload or {})}
    r = httpx.post(url, headers=_headers(), json=body, timeout=15.0)
    r.raise_for_status()


def claim_due_posts() -> List[str]:
    url = f'{_base()}/api/internal/worker/scheduler/claim-due-posts'
    r = httpx.post(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return list(data.get('ids') or [])


def claim_due_campaigns() -> List[str]:
    url = f'{_base()}/api/internal/worker/scheduler/claim-due-campaigns'
    r = httpx.post(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return list(data.get('ids') or [])


def get_account_worker_context(account_id: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/accounts/{account_id}/worker-context'
    r = httpx.get(url, headers=_headers(), timeout=60.0)
    r.raise_for_status()
    return r.json()


def list_accounts_authorized(
    provider: Optional[str] = None,
    *,
    workspace_id: Optional[str] = None,
    kind: Optional[str] = None,
) -> List[Dict[str, str]]:
    url = f'{_base()}/api/internal/worker/accounts/list'
    params: Dict[str, str] = {}
    if provider:
        params['provider'] = provider
    if workspace_id:
        params['workspace_id'] = str(workspace_id)
    if kind:
        params['kind'] = kind
    r = httpx.get(url, headers=_headers(), params=params, timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return list(data.get('items') or [])


def get_integration_config_decrypted(name: str, workspace_id: Optional[str] = None) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/integration-config/{name}'
    params = {'workspace_id': workspace_id} if workspace_id else None
    r = httpx.get(url, headers=_headers(), params=params, timeout=60.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def get_ai_catalog() -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ai-catalog'
    r = httpx.get(url, headers=_headers(), timeout=30.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def get_ai_workspace_config(workspace_id: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ai-workspace-config'
    r = httpx.get(
        url,
        headers=_headers(),
        params={'workspace_id': str(workspace_id)},
        timeout=30.0,
    )
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def record_ai_execution(body: Dict[str, Any]) -> None:
    """Append one row to ai_executions (fire-and-forget safe for callers)."""
    url = f'{_base()}/api/internal/worker/ai-executions'
    r = httpx.post(url, headers=_headers(), json=body, timeout=10.0)
    r.raise_for_status()


def get_service_decrypted(name: str, workspace_id: Optional[str] = None) -> Dict[str, Any]:
    """Alias for ``get_integration_config_decrypted`` (legacy name)."""
    return get_integration_config_decrypted(name, workspace_id)


def upsert_audience(account_id: str, date: str, total: int) -> None:
    url = f'{_base()}/api/internal/worker/audience'
    r = httpx.put(
        url,
        headers=_headers(),
        json={'account_id': str(account_id), 'date': str(date), 'total': int(total)},
        timeout=60.0,
    )
    r.raise_for_status()


def bulk_upsert_metrics(items: List[Dict[str, Any]]) -> None:
    url = f'{_base()}/api/internal/worker/metrics/bulk-upsert'
    r = httpx.put(url, headers=_headers(), json={'items': items}, timeout=120.0)
    r.raise_for_status()


def get_imported_posts_twitter_aggregate(account_id: str) -> List[Dict[str, Any]]:
    url = f'{_base()}/api/internal/worker/aggregates/imported-posts-twitter-metrics/{account_id}'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return list(data.get('items') or [])


def get_imported_posts_instagram_aggregate(account_id: str) -> List[Dict[str, Any]]:
    url = f'{_base()}/api/internal/worker/aggregates/imported-posts-instagram-metrics/{account_id}'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return list(data.get('items') or [])


def prune_old_imports() -> Dict[str, int]:
    url = f'{_base()}/api/internal/worker/maintenance/prune-old-imports'
    r = httpx.post(url, headers=_headers(), timeout=300.0)
    r.raise_for_status()
    return r.json()


def upsert_imported_post(
    account_id: str,
    provider_post_id: str,
    content: Dict[str, Any],
    metrics: Dict[str, Any],
) -> None:
    url = f'{_base()}/api/internal/worker/imported-posts/upsert'
    r = httpx.put(
        url,
        headers=_headers(),
        json={
            'account_id': str(account_id),
            'provider_post_id': str(provider_post_id),
            'content': content,
            'metrics': metrics,
        },
        timeout=60.0,
    )
    r.raise_for_status()


def upsert_facebook_insight(account_id: str, insight_type: int, value: Any, date: str) -> None:
    url = f'{_base()}/api/internal/worker/facebook-insights/upsert'
    r = httpx.put(
        url,
        headers=_headers(),
        json={
            'account_id': str(account_id),
            'type': int(insight_type),
            'value': value,
            'date': str(date),
        },
        timeout=60.0,
    )
    r.raise_for_status()


def get_ads_sync_job_plan() -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/sync-job-plan'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    return r.json()


def get_ads_sync_workspace_context(workspace_id: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/sync-workspace-context/{workspace_id}'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    return r.json()


def apply_ads_workspace_sync(
    workspace_id: str,
    google_campaigns: List[Dict[str, Any]],
    meta_campaigns: List[Dict[str, Any]],
) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/sync-workspace-apply'
    body = {
        'workspace_id': str(workspace_id),
        'google_campaigns': google_campaigns,
        'meta_campaigns': meta_campaigns,
    }
    r = httpx.post(url, headers=_headers(), json=body, timeout=600.0)
    r.raise_for_status()
    return r.json()


def get_campaign_publish_bundle(campaign_id: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/campaigns/{campaign_id}/publish-bundle'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    return r.json()


def append_campaign_publish_error(campaign_id: str, message: str) -> None:
    url = f'{_base()}/api/internal/worker/ads/campaigns/{campaign_id}/publish-errors'
    r = httpx.post(url, headers=_headers(), json={'message': message}, timeout=60.0)
    r.raise_for_status()


def patch_campaign_google_publish_result(
    campaign_id: str,
    platform_campaign_id: str,
    platform_ad_set_id: Optional[str] = None,
    platform_ad_id: Optional[str] = None,
) -> None:
    url = f'{_base()}/api/internal/worker/ads/campaigns/{campaign_id}/google-publish-result'
    body: Dict[str, Any] = {'platform_campaign_id': str(platform_campaign_id)}
    if platform_ad_set_id is not None:
        body['platform_ad_set_id'] = platform_ad_set_id
    if platform_ad_id is not None:
        body['platform_ad_id'] = platform_ad_id
    r = httpx.patch(url, headers=_headers(), json=body, timeout=60.0)
    r.raise_for_status()


def persist_agent_published_campaign(body: Dict[str, Any]) -> Dict[str, Any]:
    """Upsert ads_campaigns after agent workflow publishes to Google/Meta."""
    url = f'{_base()}/api/internal/worker/ads/campaigns/agent-publish'
    r = httpx.post(url, headers=_headers(), json=body, timeout=60.0)
    r.raise_for_status()
    return r.json()


def get_budget_alert_campaigns() -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/scheduler/budget-alert-campaigns'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    return r.json()


def get_weekly_report_snapshot() -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/scheduler/weekly-report-snapshot'
    r = httpx.get(url, headers=_headers(), timeout=300.0)
    r.raise_for_status()
    return r.json()


def send_weekly_report_mail(
    *,
    emails: List[str],
    workspace_name: str,
    week_label: str,
    stats: Dict[str, Any],
) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/mailer/weekly-report'
    body = {
        'emails': emails,
        'workspaceName': workspace_name,
        'weekLabel': week_label,
        'stats': stats,
    }
    r = httpx.post(url, headers=_headers(), json=body, timeout=120.0)
    r.raise_for_status()
    return r.json()


def list_active_ads_campaign_ids() -> List[str]:
    url = f'{_base()}/api/internal/worker/ads/campaigns/active-ids'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return list(data.get('ids') or [])


def get_ads_campaign_worker_snapshot(campaign_id: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/campaigns/{campaign_id}/snapshot'
    r = httpx.get(url, headers=_headers(), timeout=60.0)
    r.raise_for_status()
    data = r.json()
    c = data.get('campaign')
    return c if isinstance(c, dict) else {}


def patch_campaign_assets(campaign_id: str, assets: Dict[str, Any]) -> None:
    url = f'{_base()}/api/internal/worker/ads/campaigns/{campaign_id}/campaign-assets'
    r = httpx.patch(url, headers=_headers(), json={'assets': assets}, timeout=60.0)
    r.raise_for_status()


def patch_campaign_optimization(campaign_id: str, optimization: Dict[str, Any]) -> None:
    url = f'{_base()}/api/internal/worker/ads/campaigns/{campaign_id}/campaign-optimization'
    r = httpx.patch(url, headers=_headers(), json={'optimization': optimization}, timeout=60.0)
    r.raise_for_status()


def run_campaign_optimization(campaign_id: str, body: Dict[str, Any] | None = None) -> Dict[str, Any]:
    """Same logic as POST /api/ads/campaigns/:id/optimize (via shared adsOptimization service)."""
    url = f'{_base()}/api/internal/worker/ads/campaigns/{campaign_id}/optimize'
    r = httpx.post(url, headers=_headers(), json=body or {}, timeout=300.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def patch_campaign_worker_legacy_assets(campaign_id: str, assets: Dict[str, Any]) -> None:
    """Deprecated alias — use patch_campaign_assets."""
    patch_campaign_assets(campaign_id, assets)


def patch_campaign_worker_legacy_optimization(campaign_id: str, optimization: Dict[str, Any]) -> None:
    """Deprecated alias — use patch_campaign_optimization."""
    patch_campaign_optimization(campaign_id, optimization)


def get_agent_workflow(workflow_id: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/agent/workflows/{workflow_id}'
    r = httpx.get(url, headers=_headers(), timeout=60.0)
    r.raise_for_status()
    data = r.json()
    wf = data.get('workflow')
    return wf if isinstance(wf, dict) else {}


def patch_agent_workflow(workflow_id: str, fields: Dict[str, Any]) -> None:
    url = f'{_base()}/api/internal/worker/agent/workflows/{workflow_id}'
    r = httpx.patch(url, headers=_headers(), json=fields, timeout=60.0)
    r.raise_for_status()


def create_post(body: Dict[str, Any]) -> Dict[str, Any]:
    """Persist post via API (DB truth in apps/api — tasks.social.create_draft_post)."""
    url = f'{_base()}/api/internal/worker/posts/create'
    r = httpx.post(url, headers=_headers(), json=body, timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def fetch_media_file(media_id: str, *, workspace_id: str | None = None) -> Dict[str, Any]:
    """Load workspace media library file as data URL (worker → API, not localhost uploads URL)."""
    mid = str(media_id or '').strip()
    if not mid:
        raise ValueError('media_id is required')
    url = f'{_base()}/api/internal/worker/media/{mid}/file'
    params: Dict[str, str] = {}
    if workspace_id:
        params['workspace_id'] = str(workspace_id)
    r = httpx.get(url, headers=_headers(), params=params or None, timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def schedule_post(body: Dict[str, Any]) -> Dict[str, Any]:
    """Schedule draft post via API (tasks.social.schedule_post)."""
    post_id = str(body.get('post_id') or '').strip()
    if not post_id:
        raise ValueError('post_id is required')
    url = f'{_base()}/api/internal/worker/posts/{post_id}/schedule'
    r = httpx.post(url, headers=_headers(), json=body, timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def prepare_publish_post(body: Dict[str, Any]) -> Dict[str, Any]:
    """Attach target pages before tasks.social.publish_post runs."""
    post_id = str(body.get('post_id') or '').strip()
    if not post_id:
        raise ValueError('post_id is required')
    url = f'{_base()}/api/internal/worker/posts/{post_id}/publish-prepare'
    r = httpx.post(url, headers=_headers(), json=body, timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def run_landing_page_workflow(body: Dict[str, Any]) -> Dict[str, Any]:
    """Create LP → generate copy → optional publish (agent tool / Beat)."""
    url = f'{_base()}/api/internal/worker/ads/landing-pages/run-workflow'
    r = httpx.post(url, headers=_headers(), json=body, timeout=180.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def cluster_seo_keywords(body: Dict[str, Any]) -> Dict[str, Any]:
    """Cluster seed keywords by intent — same as POST /api/seo/keywords/cluster."""
    url = f'{_base()}/api/internal/worker/seo/keywords/cluster'
    r = httpx.post(url, headers=_headers(), json=body, timeout=180.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def check_seo_keyword_ranks(body: Dict[str, Any]) -> Dict[str, Any]:
    """Check SERP ranks for workspace keyword targets."""
    url = f'{_base()}/api/internal/worker/seo/keywords/check-ranks'
    r = httpx.post(url, headers=_headers(), json=body, timeout=240.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def audit_seo_landing_pages(body: Dict[str, Any]) -> Dict[str, Any]:
    """Rules-based SEO audit on workspace landing pages."""
    url = f'{_base()}/api/internal/worker/seo/landing-pages/audit'
    params = {}
    ws = body.get('workspace_id')
    if ws:
        params['workspace_id'] = str(ws)
    r = httpx.get(url, headers=_headers(), params=params or None, timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def run_hourly_budget_pacing(*, auto_pause_overspend: bool = False) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/pacing/run-hourly'
    r = httpx.post(
        url,
        headers=_headers(),
        json={'auto_pause_overspend': auto_pause_overspend},
        timeout=300.0,
    )
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def run_hourly_bid_optimization(*, auto_apply: bool = False) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/bid-optimization/run-hourly'
    r = httpx.post(
        url,
        headers=_headers(),
        json={'auto_apply': auto_apply},
        timeout=600.0,
    )
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def run_daily_negative_keyword_review() -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/negative-keywords/run-daily'
    r = httpx.post(url, headers=_headers(), json={}, timeout=600.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def run_workspace_budget_pacing(body: Dict[str, Any]) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/budget/pacing'
    r = httpx.post(url, headers=_headers(), json=body, timeout=300.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def run_workspace_budget_reallocation(body: Dict[str, Any]) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/budget/reallocation'
    r = httpx.post(url, headers=_headers(), json=body, timeout=180.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def run_workspace_bid_optimization(body: Dict[str, Any]) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/optimization/bid'
    r = httpx.post(url, headers=_headers(), json=body, timeout=300.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def run_workspace_quality_score_monitor(body: Dict[str, Any]) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/optimization/quality-score'
    params = {k: str(v) for k, v in body.items() if v is not None}
    r = httpx.get(url, headers=_headers(), params=params, timeout=240.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def run_workspace_asset_ab_analysis(body: Dict[str, Any]) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/ads/optimization/asset-ab'
    r = httpx.post(url, headers=_headers(), json=body, timeout=240.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def patch_landing_page_content(
    landing_page_id: str,
    *,
    headline: str,
    subheadline: str,
    body: str,
    cta_text: str,
) -> None:
    url = f'{_base()}/api/internal/worker/ads/landing-pages/{landing_page_id}/landing-page-content'
    r = httpx.patch(
        url,
        headers=_headers(),
        json={
            'headline': headline,
            'subheadline': subheadline,
            'body': body,
            'cta_text': cta_text,
        },
        timeout=60.0,
    )
    r.raise_for_status()


def patch_landing_page_worker_legacy_content(
    landing_page_id: str,
    *,
    headline: str,
    subheadline: str,
    body: str,
    cta_text: str,
) -> None:
    """Deprecated alias — use patch_landing_page_content."""
    patch_landing_page_content(
        landing_page_id,
        headline=headline,
        subheadline=subheadline,
        body=body,
        cta_text=cta_text,
    )


def list_comment_sync_post_ids() -> List[str]:
    url = f'{_base()}/api/internal/worker/comment-sync/post-ids'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return list(data.get('ids') or [])


def get_comment_sync_bundle(post_id: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/posts/{post_id}/comment-sync-bundle'
    r = httpx.get(url, headers=_headers(), timeout=120.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def upsert_post_comment(body: Dict[str, Any]) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/post-comments/upsert'
    r = httpx.post(url, headers=_headers(), json=body, timeout=60.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def get_post_comment_worker_context(comment_uuid: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/post-comments/{comment_uuid}/worker-context'
    r = httpx.get(url, headers=_headers(), timeout=60.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def analyze_post_comment(comment_uuid: str) -> Dict[str, Any]:
    url = f'{_base()}/api/internal/worker/post-comments/{comment_uuid}/analyze'
    r = httpx.post(url, headers=_headers(), json={}, timeout=180.0)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def apply_post_comment_reply_result(comment_uuid: str, body: Dict[str, Any]) -> None:
    url = f'{_base()}/api/internal/worker/post-comments/{comment_uuid}/reply-result'
    r = httpx.patch(url, headers=_headers(), json=body, timeout=60.0)
    r.raise_for_status()
