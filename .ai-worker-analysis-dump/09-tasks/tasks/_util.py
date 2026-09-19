import json
import logging
import os

from db import get_redis

logger = logging.getLogger(__name__)
EVENTS_CHANNEL = os.getenv('EVENTS_CHANNEL', 'agent_market:events')


def emit(event: str, payload: dict):
    try:
        get_redis().publish(EVENTS_CHANNEL, json.dumps({'event': event, **payload}))
    except Exception as exc:
        logger.warning('Failed to emit event %s: %s', event, exc)
