"""
Bridge: Node API LPUSHes JSON task envelopes (see apps/api/src/lib/celeryEnqueue.js).
This task drains that list and dispatches via the real Celery app — avoids writing
non-Kombu payloads onto the broker's native queue keys.
"""

import json
import logging
import os

from celery_app import celery_app
from db import get_redis

logger = logging.getLogger(__name__)

DEFAULT_BRIDGE_KEY = 'agentmarket:api_task_bridge'


@celery_app.task(name='tasks.bridge_api_celery_queue')
def bridge_api_celery_queue():
    r = get_redis()
    key = os.getenv('CELERY_REDIS_LIST', DEFAULT_BRIDGE_KEY)
    for _ in range(100):
        raw = r.rpop(key)
        if not raw:
            break
        try:
            msg = json.loads(raw)
            name = msg.get('task')
            if not name or name == 'tasks.bridge_api_celery_queue':
                continue
            args = msg.get('args') or []
            kwargs = msg.get('kwargs') or {}
            celery_app.send_task(name, args=args, kwargs=kwargs)
            logger.debug('Bridged Celery task %s', name)
        except Exception as exc:
            logger.warning('bridge_api_celery_queue drop: %s raw=%s', exc, (raw or '')[:200])
