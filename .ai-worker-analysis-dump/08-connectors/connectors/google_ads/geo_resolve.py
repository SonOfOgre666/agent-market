"""Resolve GeoTargetingIntent to Google Ads geo_target_constant IDs."""

from __future__ import annotations

from typing import Any, Dict, List

from lib.planner.geo_targeting_intent import (
    GeoLocationSpec,
    GeoTargetingIntent,
    normalize_geo_location_spec,
)
from lib.planner.geo_targeting_resolve import pick_best_google_result

from .geo_search import search_geo_target_constants

_META_TYPE_TO_GOOGLE_SEARCH: dict[str, str | None] = {
    'country': 'country',
    'state': None,
    'region': None,
    'city': None,
    'metro': None,
    'zip': None,
    'auto': None,
}


def _location_types_for_spec(spec: GeoLocationSpec) -> list[str] | None:
    hint = spec.location_type
    if hint == 'country':
        return None  # Google suggest handles countries without filter
    return None


def _resolve_one(
    gcfg: Dict[str, Any],
    *,
    customer_id: str,
    spec: GeoLocationSpec,
    locale: str = 'en',
) -> Dict[str, Any] | None:
    from lib.google_geo_targets import country_label_for_iso, geo_target_id_for_iso

    if spec.location_type == 'country':
        iso = (spec.country_context or '').strip().upper()
        if not iso and len((spec.name or '').strip()) == 2:
            iso = spec.name.strip().upper()
        if len(iso) == 2:
            gid = geo_target_id_for_iso(iso)
            if gid:
                return {
                    'geo_target_constant_id': gid,
                    'name': country_label_for_iso(iso) or iso,
                    'target_type': 'Country',
                    'country_code': iso,
                    'role': spec.role,
                    'query': spec.name,
                }

    out = search_geo_target_constants(
        gcfg,
        customer_id=customer_id,
        query=spec.name,
        locale=locale,
        country_code=spec.country_context,
        limit=15,
    )
    if not out.get('ok'):
        return None
    rows = out.get('data') or []
    if not isinstance(rows, list):
        return None
    picked = pick_best_google_result(spec, rows)
    if not picked:
        return None
    return {
        'geo_target_constant_id': int(picked['geo_target_constant_id']),
        'name': str(picked.get('name') or spec.name),
        'target_type': str(picked.get('target_type') or ''),
        'country_code': str(picked.get('country_code') or ''),
        'role': spec.role,
        'query': spec.name,
    }


def resolve_geo_targeting_intent(
    google_ads_client_config: Dict[str, Any],
    *,
    customer_id: str,
    intent: GeoTargetingIntent | None = None,
    locations: List[Dict[str, Any]] | None = None,
    locale: str = 'en',
) -> Dict[str, Any]:
    """
    Resolve include/exclude location specs to Google geo_target_constant IDs.

    ``locations`` may be a flat list with role on each item, or intent with include/exclude.
    """
    specs: list[GeoLocationSpec] = []
    if intent:
        specs.extend(intent.include)
        specs.extend(intent.exclude)
    elif locations:
        for raw in locations:
            if not isinstance(raw, dict):
                continue
            spec = GeoLocationSpec.from_dict(raw)
            if spec:
                specs.append(spec)

    if not specs:
        return {'ok': False, 'error': 'At least one location is required'}

    include_ids: List[int] = []
    exclude_ids: List[int] = []
    resolved: List[Dict[str, Any]] = []
    errors: List[str] = []

    for spec in specs:
        spec = normalize_geo_location_spec(spec)
        row = _resolve_one(
            google_ads_client_config,
            customer_id=customer_id,
            spec=spec,
            locale=locale,
        )
        if not row:
            errors.append(f'Could not resolve location: {spec.name}')
            continue
        resolved.append(row)
        gid = int(row['geo_target_constant_id'])
        if spec.role == 'exclude':
            if gid not in exclude_ids:
                exclude_ids.append(gid)
        elif gid not in include_ids:
            include_ids.append(gid)

    if not include_ids and not exclude_ids:
        return {
            'ok': False,
            'error': '; '.join(errors) if errors else 'No locations resolved',
            'errors': errors,
        }

    summary = intent.summary if intent else ''
    return {
        'ok': True,
        'include_ids': include_ids,
        'exclude_ids': exclude_ids,
        'resolved': resolved,
        'summary': summary,
        'errors': errors,
    }
