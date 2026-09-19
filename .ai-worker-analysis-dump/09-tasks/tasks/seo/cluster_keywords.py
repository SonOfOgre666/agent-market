"""SEO keyword clustering — agent + API parity via internal worker routes."""

from __future__ import annotations

from typing import Any

from celery_app import celery_app
from lib import worker_api


def run_cluster_seo_keywords(body: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = dict(body or {})
    if not worker_api.configured():
        raise RuntimeError('WORKER_API_SECRET not set')
    return worker_api.cluster_seo_keywords(payload)


@celery_app.task(name='tasks.seo.cluster_keywords')
def cluster_keywords(payload: dict | None = None) -> dict[str, Any]:
    return run_cluster_seo_keywords(payload or {})
