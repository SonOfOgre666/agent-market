"""
Cron-equivalent work moved from ``apps/api/src/queue/scheduler.js`` (Node) to Celery Beat.

Single execution engine: only ``send_task`` / ``delay`` — no Node BLPOP consumers.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from celery_app import celery_app
from db import get_redis
from lib import worker_api

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.scheduler.tick_due_posts')
def tick_due_posts():
    if not worker_api.configured():
        logger.warning('[scheduler] WORKER_API_SECRET not set — tick_due_posts skipped')
        return
    try:
        ids = worker_api.claim_due_posts()
    except Exception as exc:
        logger.exception('[scheduler] claim_due_posts failed: %s', exc)
        return
    for pid in ids:
        celery_app.send_task('tasks.social.publish_post', args=[pid])
    if ids:
        logger.info('[scheduler] tick_due_posts queued %d post(s)', len(ids))


@celery_app.task(name='tasks.scheduler.tick_due_campaigns')
def tick_due_campaigns():
    if not worker_api.configured():
        logger.warning('[scheduler] WORKER_API_SECRET not set — tick_due_campaigns skipped')
        return
    try:
        ids = worker_api.claim_due_campaigns()
    except Exception as exc:
        logger.exception('[scheduler] claim_due_campaigns failed: %s', exc)
        return
    for cid in ids:
        celery_app.send_task('tasks.ads.publish_campaign', args=[cid])
    if ids:
        logger.info('[scheduler] tick_due_campaigns queued %d campaign(s)', len(ids))


@celery_app.task(name='tasks.scheduler.hourly_import_followers')
def hourly_import_followers():
    if not worker_api.configured():
        logger.warning('[scheduler] hourly_import_followers skipped — WORKER_API_SECRET not set')
        return
    for row in worker_api.list_accounts_authorized():
        p = row.get('provider') or ''
        aid = row['id']
        if p == 'twitter':
            celery_app.send_task('tasks.imports.import_twitter_followers', args=[aid])
        elif p == 'facebook':
            celery_app.send_task('tasks.imports.import_facebook_followers', args=[aid])
        elif p in ('instagram', 'instagram_login'):
            celery_app.send_task('tasks.imports.import_instagram_followers', args=[aid])


@celery_app.task(name='tasks.scheduler.six_hourly_twitter_posts')
def six_hourly_twitter_posts():
    if not worker_api.configured():
        logger.warning('[scheduler] six_hourly_twitter_posts skipped — WORKER_API_SECRET not set')
        return
    for row in worker_api.list_accounts_authorized('twitter'):
        celery_app.send_task('tasks.imports.import_twitter_posts', args=[row['id']])


@celery_app.task(name='tasks.scheduler.daily_metrics_midnight_utc')
def daily_metrics_midnight_utc():
    if not worker_api.configured():
        logger.warning('[scheduler] daily_metrics_midnight_utc skipped — WORKER_API_SECRET not set')
        return
    for row in worker_api.list_accounts_authorized():
        aid = row['id']
        p = row.get('provider') or ''
        if p == 'twitter':
            celery_app.send_task('tasks.analytics.process_twitter_metrics', args=[aid])
        elif p == 'facebook':
            celery_app.send_task('tasks.imports.import_facebook_followers', args=[aid])
            celery_app.send_task('tasks.imports.import_facebook_insights', args=[aid])
        elif p in ('instagram', 'instagram_login'):
            celery_app.send_task('tasks.imports.import_instagram_followers', args=[aid])
            celery_app.send_task('tasks.imports.import_instagram_insights', args=[aid])
            celery_app.send_task('tasks.imports.import_instagram_media', args=[aid])


@celery_app.task(name='tasks.scheduler.daily_delete_old_imports')
def daily_delete_old_imports():
    if not worker_api.configured():
        logger.warning('[scheduler] daily_delete_old_imports skipped — WORKER_API_SECRET not set')
        return
    try:
        stats = worker_api.prune_old_imports()
        logger.info(
            '[scheduler] delete-old-data removed imported_posts=%s facebook_insights=%s',
            stats.get('imported_posts'),
            stats.get('facebook_insights'),
        )
    except Exception as exc:
        logger.exception('[scheduler] prune_old_imports failed: %s', exc)


@celery_app.task(name='tasks.scheduler.hourly_budget_alerts')
def hourly_budget_alerts():
    if not worker_api.configured():
        logger.warning('[scheduler] hourly_budget_alerts skipped — WORKER_API_SECRET not set')
        return
    r = get_redis()
    try:
        data = worker_api.get_budget_alert_campaigns()
    except Exception as exc:
        logger.exception('[scheduler] budget-alert-campaigns failed: %s', exc)
        return
    campaigns = data.get('campaigns') or []
    thresholds = [80, 90, 100]
    for c in campaigns:
        cid = c.get('_id') or c.get('id')
        if not cid:
            continue
        budget = ((c.get('budget') or {}).get('amount')) or 0
        if not budget:
            continue
        spend = ((c.get('metrics') or {}).get('spend')) or 0
        pct = int((spend / budget) * 100) if budget else 0
        for th in thresholds:
            if pct < th:
                continue
            key = f'budget_alert:{cid}:{th}'
            if r.get(key):
                continue
            r.setex(key, 86400, '1')
            try:
                worker_api.emit_event(
                    'budget_alert',
                    {
                        'campaign_id': str(cid),
                        'campaign_name': c.get('name'),
                        'percent': th,
                        'spend': spend,
                        'budget': budget,
                        'workspace_id': c.get('workspace_id'),
                    },
                )
            except Exception as exc:
                logger.warning('[scheduler] budget_alert emit_event failed: %s', exc)
            logger.info('[scheduler] budget alert %s%% campaign=%s', th, c.get('name'))


@celery_app.task(name='tasks.scheduler.hourly_budget_pacing')
def hourly_budget_pacing():
    """KPI pacing snapshots + optional local pause for overspending campaigns."""
    if not worker_api.configured():
        logger.warning('[scheduler] hourly_budget_pacing skipped — WORKER_API_SECRET not set')
        return
    auto_pause = os.getenv('ADS_PACING_AUTO_PAUSE', '').lower() in ('1', 'true', 'yes')
    try:
        out = worker_api.run_hourly_budget_pacing(auto_pause_overspend=auto_pause)
        logger.info(
            '[scheduler] hourly_budget_pacing workspaces=%s',
            out.get('workspaces'),
        )
    except Exception as exc:
        logger.exception('[scheduler] hourly_budget_pacing failed: %s', exc)


@celery_app.task(name='tasks.scheduler.hourly_bid_optimization')
def hourly_bid_optimization():
    """CPA/ROAS bid analysis; optional auto-apply for high-priority bid decreases."""
    if not worker_api.configured():
        logger.warning('[scheduler] hourly_bid_optimization skipped — WORKER_API_SECRET not set')
        return
    auto_apply = os.getenv('ADS_BID_AUTO_APPLY', '').lower() in ('1', 'true', 'yes')
    try:
        out = worker_api.run_hourly_bid_optimization(auto_apply=auto_apply)
        logger.info(
            '[scheduler] hourly_bid_optimization workspaces=%s',
            out.get('workspaces'),
        )
    except Exception as exc:
        logger.exception('[scheduler] hourly_bid_optimization failed: %s', exc)


@celery_app.task(name='tasks.scheduler.daily_negative_keyword_review')
def daily_negative_keyword_review():
    if not worker_api.configured():
        logger.warning('[scheduler] daily_negative_keyword_review skipped — WORKER_API_SECRET not set')
        return
    try:
        out = worker_api.run_daily_negative_keyword_review()
        logger.info(
            '[scheduler] daily_negative_keyword_review reviewed=%s',
            out.get('reviewed'),
        )
    except Exception as exc:
        logger.exception('[scheduler] daily_negative_keyword_review failed: %s', exc)


@celery_app.task(name='tasks.scheduler.daily_prune_upload_tmp')
def daily_prune_upload_tmp():
    base = Path(os.getenv('STORAGE_LOCAL_PATH', os.path.join(os.getcwd(), 'uploads')))
    tmp = base / '.tmp'
    if not tmp.is_dir():
        return
    cutoff = datetime.now(timezone.utc).timestamp() * 1000 - 86400000
    for fp in tmp.iterdir():
        try:
            st = fp.stat()
            if st.st_mtime * 1000 < cutoff:
                fp.unlink(missing_ok=True)
        except OSError as exc:
            logger.debug('[scheduler] prune skip %s: %s', fp, exc)


@celery_app.task(name='tasks.scheduler.tick_comment_sync')
def tick_comment_sync():
    if not worker_api.configured():
        logger.warning('[scheduler] tick_comment_sync skipped — WORKER_API_SECRET not set')
        return
    try:
        ids = worker_api.list_comment_sync_post_ids()
    except Exception as exc:
        logger.exception('[scheduler] list_comment_sync_post_ids failed: %s', exc)
        return
    for pid in ids:
        celery_app.send_task('tasks.social.sync_post_comments', args=[pid])
    if ids:
        logger.info('[scheduler] tick_comment_sync queued %d post(s)', len(ids))


@celery_app.task(name='tasks.scheduler.weekly_report_monday_8utc')
def weekly_report_monday_8utc():
    if not worker_api.configured():
        logger.warning('[scheduler] weekly_report_monday_8utc skipped — WORKER_API_SECRET not set')
        return
    try:
        snap = worker_api.get_weekly_report_snapshot()
    except Exception as exc:
        logger.exception('[scheduler] weekly-report-snapshot failed: %s', exc)
        return

    for block in snap.get('reports') or []:
        wid = block.get('workspace_id')
        stats = block.get('stats') or {}
        emails = block.get('emails') or []
        week_label = block.get('week_label') or snap.get('week_label') or ''
        wname = block.get('workspace_name') or 'Your Workspace'
        if not emails:
            continue
        try:
            addr_list = [str(e).strip() for e in emails if e and '@' in str(e)]
            if not addr_list:
                continue
            out = worker_api.send_weekly_report_mail(
                emails=addr_list,
                workspace_name=str(wname),
                week_label=str(week_label),
                stats=stats,
            )
            if out.get('skipped'):
                logger.warning('[scheduler] weekly report mail skipped (MAIL_* not configured) workspace=%s', wid)
            else:
                logger.info('[scheduler] weekly report mail sent workspace=%s recipients=%d', wid, len(addr_list))
        except Exception as exc:
            logger.error('[scheduler] weekly_report workspace=%s err=%s', wid, exc)
