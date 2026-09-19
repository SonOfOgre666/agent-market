"""SEO rank checks for workspace targets — agent + API parity."""

from __future__ import annotations

from typing import Any

from celery_app import celery_app
from lib import worker_api


@celery_app.task(name='tasks.seo.check_workspace_ranks')
def check_workspace_ranks(payload: dict | None = None) -> dict[str, Any]:
    body = dict(payload or {})
    if not worker_api.configured():
        raise RuntimeError('WORKER_API_SECRET not set')
    return worker_api.check_seo_keyword_ranks(body)


def run_check_workspace_ranks(body: dict[str, Any] | None = None) -> dict[str, Any]:
    return check_workspace_ranks(body or {})
