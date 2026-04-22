import os
from dotenv import load_dotenv
from celery import Celery
from celery.schedules import crontab

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

# Celery Beat schedule — mirrors Node.js scheduler for AI-specific tasks
celery_app.conf.beat_schedule = {
    # Every minute: publish scheduled social posts that are due
    'publish-scheduled-posts': {
        'task': 'tasks.publish_scheduled_posts',
        'schedule': 60.0,
    },
    # Every hour: optimize active campaigns
    'optimize-active-campaigns': {
        'task': 'tasks.optimize_active_campaigns',
        'schedule': crontab(minute=30),
    },
    # Every day at 7am UTC: generate weekly AI content suggestions
    'generate-content-suggestions': {
        'task': 'tasks.generate_content_suggestions',
        'schedule': crontab(hour=7, minute=0),
    },
}

if __name__ == '__main__':
    celery_app.start()
