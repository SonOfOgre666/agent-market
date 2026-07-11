"""SEO landing page audit — agent + API parity."""

from __future__ import annotations

from typing import Any

from celery_app import celery_app
from lib import worker_api


def run_audit_seo_landing_pages(body: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = dict(body or {})
    if not worker_api.configured():
        raise RuntimeError('WORKER_API_SECRET not set')
    return worker_api.audit_seo_landing_pages(payload)


@celery_app.task(name='tasks.seo.audit_landing_pages')
def audit_landing_pages(payload: dict | None = None) -> dict[str, Any]:
    return run_audit_seo_landing_pages(payload or {})
