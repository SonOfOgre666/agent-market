"""Read-only Google Ads API documentation (reference docs.py)."""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

logger = logging.getLogger(__name__)

_CONTEXT_DIR = Path(__file__).resolve().parents[4] / 'reference_ads' / 'google_ads' / 'context'
_GAQL_SCHEMA_VERSION = 'v24'
_GAQL_SCHEMA_BASE = f'https://gaql-query-builder.uc.r.appspot.com/schemas/{_GAQL_SCHEMA_VERSION}'

_FIELDS_CACHE: Dict[str, Any] | None = None
_VIEW_JSON_CACHE: Dict[str, Dict[str, Any]] = {}

# Minimal metadata when fields.yaml and online schema fetch are unavailable (dev / offline).
_BUILTIN_FIELD_HINTS: Dict[str, Dict[str, str]] = {
    'campaign.name': {
        'description': 'Campaign name (resource attribute).',
        'data_type': 'STRING',
        'view': 'campaign',
    },
    'metrics.clicks': {
        'description': 'Number of clicks.',
        'data_type': 'INT64',
        'view': 'metrics',
    },
    'ad_group.id': {
        'description': 'Ad group ID.',
        'data_type': 'INT64',
        'view': 'ad_group',
    },
}


def _read_text(name: str) -> str:
    path = _CONTEXT_DIR / name
    if not path.is_file():
        return f'Documentation file not found: {name}'
    return path.read_text(encoding='utf-8')


def _load_fields_yaml() -> Dict[str, Any]:
    global _FIELDS_CACHE
    if _FIELDS_CACHE is not None:
        return _FIELDS_CACHE
    fields_path = _CONTEXT_DIR / 'fields.yaml'
    if fields_path.is_file():
        _FIELDS_CACHE = yaml.safe_load(fields_path.read_text(encoding='utf-8')) or {}
    else:
        _FIELDS_CACHE = {}
    return _FIELDS_CACHE


@lru_cache(maxsize=1)
def _list_views() -> tuple[str, ...]:
    views_path = _CONTEXT_DIR / 'views.yaml'
    if not views_path.is_file():
        return tuple()
    data = yaml.safe_load(views_path.read_text(encoding='utf-8')) or []
    if isinstance(data, list):
        return tuple(str(v) for v in data if v)
    return tuple()


def _fetch_view_json(view: str) -> Optional[Dict[str, Any]]:
    if view in _VIEW_JSON_CACHE:
        return _VIEW_JSON_CACHE[view]
    try:
        import httpx

        url = f'{_GAQL_SCHEMA_BASE}/{view}.json'
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url)
            resp.raise_for_status()
            data = resp.json()
        _VIEW_JSON_CACHE[view] = data
        return data
    except Exception as exc:  # noqa: BLE001
        logger.debug('[connector.google_ads.docs] view %s fetch failed: %s', view, exc)
        return None


def _field_detail_from_view_json(view_json: Dict[str, Any], field: str) -> Optional[Dict[str, Any]]:
    fields_meta = view_json.get('fields') or {}
    raw = fields_meta.get(field)
    if not raw or not isinstance(raw, dict):
        return None
    details = raw.get('field_details') or raw
    keys = ('description', 'data_type', 'is_repeated', 'filterable', 'sortable', 'enum_values')
    out = {k: details[k] for k in keys if k in details}
    if details.get('data_type') == 'ENUM' and details.get('enum_values'):
        out['enum_values'] = ', '.join(str(x) for x in details['enum_values'])
    out['view'] = view_json.get('name') or view_json.get('display_name')
    return out


def _resolve_field_online(field: str) -> Optional[Dict[str, Any]]:
    """Scan reporting views for field metadata (same source as generate_views.py)."""
    prefix = field.split('.')[0] if '.' in field else ''
    priority = ['campaign', 'ad_group', 'ad_group_ad', 'keyword_view', 'customer', 'metrics']
    if prefix and prefix not in ('metrics', 'segments') and prefix not in priority:
        priority.insert(0, prefix)
    seen: set[str] = set()
    ordered: List[str] = []
    for v in priority + list(_list_views()):
        if v not in seen:
            seen.add(v)
            ordered.append(v)
    for view in ordered:
        vj = _fetch_view_json(view)
        if not vj:
            continue
        for cat in ('attributes', 'segments', 'metrics'):
            if field in (vj.get(cat) or []):
                detail = _field_detail_from_view_json(vj, field)
                if detail:
                    return detail
    return None


def get_gaql_doc() -> Dict[str, Any]:
    return {'ok': True, 'content': _read_text('GAQL.md'), 'format': 'markdown'}


def get_reporting_views_doc(view: Optional[str] = None) -> Dict[str, Any]:
    if view:
        safe = ''.join(c for c in str(view) if c.isalnum() or c in ('_', '-'))
        content = _read_view_yaml(safe)
        return {'ok': True, 'view': safe, 'content': content, 'format': 'yaml'}
    return {
        'ok': True,
        'content': _read_text('Google_Ads_API_Reporting_Views.md'),
        'format': 'markdown',
    }


def _read_view_yaml(view: str) -> str:
    views_path = _CONTEXT_DIR / 'views.yaml'
    per_view = _CONTEXT_DIR / 'views' / f'{view}.yaml'
    if per_view.is_file():
        return per_view.read_text(encoding='utf-8')
    if not views_path.is_file():
        return f'views.yaml not found under {_CONTEXT_DIR}'
    data = yaml.safe_load(views_path.read_text(encoding='utf-8')) or {}
    if view in data:
        return yaml.dump({view: data[view]}, default_flow_style=False)
    keys = [k for k in data if isinstance(k, str)]
    return f'Unknown view: {view}. Available: {", ".join(sorted(keys)[:40])}{"…" if len(keys) > 40 else ""}'


def get_reporting_fields_doc(fields: List[str]) -> Dict[str, Any]:
    """Field metadata for GAQL (reference get_reporting_fields_doc)."""
    names = [str(f).strip() for f in (fields or []) if str(f).strip()]
    if not names:
        return {'ok': False, 'error': 'fields list is required'}

    cached = _load_fields_yaml()
    info: Dict[str, Any] = {}
    missing: List[str] = []

    for field in names:
        if field in cached and cached[field]:
            info[field] = cached[field]
            continue
        if field in _BUILTIN_FIELD_HINTS:
            info[field] = dict(_BUILTIN_FIELD_HINTS[field])
            continue
        online = _resolve_field_online(field)
        if online:
            info[field] = online
        else:
            missing.append(field)

    if missing and not info:
        return {
            'ok': False,
            'error': (
                f'Unknown fields: {", ".join(missing)}. '
                'Try google_docs_reporting_views or check field names.'
            ),
        }
    out: Dict[str, Any] = {'ok': True, 'fields': info, 'format': 'object'}
    if missing:
        out['missing'] = missing
        out['warning'] = f'No metadata for: {", ".join(missing)}'
    if len(info) == 1 and not missing:
        out['content'] = yaml.dump(info, default_flow_style=False)
    return out
