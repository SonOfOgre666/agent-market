"""Celery task: execute one registry tool (observable, replayable step unit)."""

from __future__ import annotations

import logging
from typing import Any

from celery_app import celery_app
from lib.dispatch.dispatcher import dispatch_tool

logger = logging.getLogger(__name__)


@celery_app.task(name='tasks.agent.run_registry_step', soft_time_limit=270, time_limit=300)
def run_registry_step(tool_id: str, payload: dict | None = None) -> Any:
    return dispatch_tool(tool_id, payload or {})
