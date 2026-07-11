import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_process_init

# Ensure worker root is on sys.path in prefork children (agents/, lib/, tasks/).
_WORKER_ROOT = Path(__file__).resolve().parent
_ROOT_STR = str(_WORKER_ROOT)
if _ROOT_STR not in sys.path:
    sys.path.insert(0, _ROOT_STR)


@worker_process_init.connect
def _celery_worker_process_init(**_kwargs):
    if _ROOT_STR not in sys.path:
        sys.path.insert(0, _ROOT_STR)


load_dotenv()

REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = os.getenv('REDIS_PORT', '6379')
REDIS_PASSWORD = os.getenv('REDIS_PASSWORD', '')
REDIS_URL = f"redis://:{REDIS_PASSWORD}@{REDIS_HOST}:{REDIS_PORT}/0" if REDIS_PASSWORD else f"redis://{REDIS_HOST}:{REDIS_PORT}/0"

celery_app = Celery(
    'agent_market',
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=['tasks'],
)

celery_app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
)

# Celery Beat — onboarding spec + extra maintenance beats
celery_app.conf.beat_schedule = {
    'optimize-active-campaigns': {
        'task': 'tasks.optimize_active_campaigns',
        'schedule': crontab(minute=30),
    },
    'bridge.api_celery_queue': {
        'task': 'tasks.bridge_api_celery_queue',
        'schedule': 5.0,
    },
    # Migrated from apps/api/src/queue/scheduler.js (Node cron)
    'scheduler.tick_due_posts': {
        'task': 'tasks.scheduler.tick_due_posts',
        'schedule': 60.0,
    },
    'scheduler.tick_due_campaigns': {
        'task': 'tasks.scheduler.tick_due_campaigns',
        'schedule': 60.0,
    },
    'scheduler.hourly_import_followers': {
        'task': 'tasks.scheduler.hourly_import_followers',
        'schedule': crontab(minute=0),
    },
    'scheduler.six_hourly_twitter_posts': {
        'task': 'tasks.scheduler.six_hourly_twitter_posts',
        'schedule': crontab(minute=0, hour='*/6'),
    },
    'scheduler.daily_metrics_midnight_utc': {
        'task': 'tasks.scheduler.daily_metrics_midnight_utc',
        'schedule': crontab(minute=0, hour=0),
    },
    'scheduler.daily_delete_old_imports': {
        'task': 'tasks.scheduler.daily_delete_old_imports',
        'schedule': crontab(minute=0, hour=4),
    },
    'scheduler.hourly_budget_alerts': {
        'task': 'tasks.scheduler.hourly_budget_alerts',
        'schedule': crontab(minute=0),
    },
    'scheduler.hourly_budget_pacing': {
        'task': 'tasks.scheduler.hourly_budget_pacing',
        'schedule': crontab(minute=15),
    },
    'scheduler.hourly_bid_optimization': {
        'task': 'tasks.scheduler.hourly_bid_optimization',
        'schedule': crontab(minute=45),
    },
    'scheduler.daily_negative_keyword_review': {
        'task': 'tasks.scheduler.daily_negative_keyword_review',
        'schedule': crontab(minute=30, hour=7),
    },
    'scheduler.daily_prune_upload_tmp': {
        'task': 'tasks.scheduler.daily_prune_upload_tmp',
        'schedule': crontab(minute=0, hour=3),
    },
    'scheduler.weekly_report_monday_8utc': {
        'task': 'tasks.scheduler.weekly_report_monday_8utc',
        'schedule': crontab(minute=0, hour=8, day_of_week=1),
    },
    'scheduler.ads_platform_sync_daily': {
        'task': 'tasks.scheduler.ads_platform_sync_daily',
        'schedule': crontab(minute=0, hour=6),
    },
    'scheduler.tick_comment_sync': {
        'task': 'tasks.scheduler.tick_comment_sync',
        'schedule': crontab(minute='*/15'),
    },
}

if __name__ == '__main__':
    celery_app.start()
