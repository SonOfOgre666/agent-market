"""Resolve GeoTargetingIntent to Meta Ads geo_locations / excluded_geo_locations."""

from __future__ import annotations

from typing import Any, Dict, List

from lib.planner.geo_targeting_intent import GeoLocationSpec, GeoTargetingIntent
from lib.planner.geo_targeting_resolve import pick_best_meta_result

from .targeting_search import search_geo_locations

_META_BUCKET_KEYS = ('countries', 'regions', 'cities', 'zips', 'geo_markets', 'country_groups')


def _empty_geo_buckets() -> Dict[str, List[Any]]:
    return {k: [] for k in _META_BUCKET_KEYS}


def _meta_type_to_bucket(meta_type: str) -> str:
    t = (meta_type or '').strip().lower()
    if t == 'country':
        return 'countries'
    if t in ('region', 'state'):
        return 'regions'
    if t == 'city':
        return 'cities'
    if t == 'zip':
        return 'zips'
    if t in ('geo_market', 'market'):
        return 'geo_markets'
    return 'regions'


def _location_types_for_spec(spec: GeoLocationSpec) -> List[str] | None:
    hint = spec.location_type
    if hint == 'country':
        return ['country']
    if hint == 'city':
        return ['city']
    if hint in ('state', 'region'):
        return ['region']
    if hint == 'zip':
        return ['zip']
    if hint == 'metro':
        return ['geo_market']
    return None


def _append_meta_location(buckets: Dict[str, List[Any]], row: Dict[str, Any]) -> None:
    meta_type = str(row.get('type') or '').lower()
    key = _meta_type_to_bucket(meta_type)
    if key == 'countries':
        code = str(row.get('country_code') or row.get('key') or '').strip().upper()
        if code and code not in buckets['countries']:
            buckets['countries'].append(code)
        return
    entry_key = str(row.get('key') or '').strip()
    if not entry_key:
        return
    entry: Dict[str, Any] = {'key': entry_key}
    if key == 'cities' and row.get('name'):
        entry['name'] = row['name']
    existing = buckets.get(key) or []
    if not any(isinstance(x, dict) and str(x.get('key')) == entry_key for x in existing):
        buckets[key].append(entry)


def _resolve_one(
    access_token: str,
    *,
    spec: GeoLocationSpec,
    api_version: str = 'v22.0',
) -> Dict[str, Any] | None:
    loc_types = _location_types_for_spec(spec)
    out = search_geo_locations(
        access_token,
        query=spec.name,
        location_types=loc_types,
        limit=15,
        api_version=api_version,
    )
    if not out.get('ok'):
        return None
    rows = out.get('data') or []
    if not isinstance(rows, list):
        return None
    picked = pick_best_meta_result(spec, rows)
    if not picked:
        return None
    return {
        **picked,
        'role': spec.role,
        'query': spec.name,
    }


def resolve_geo_targeting_intent(
    access_token: str,
    *,
    intent: GeoTargetingIntent | None = None,
    locations: List[Dict[str, Any]] | None = None,
    api_version: str = 'v22.0',
) -> Dict[str, Any]:
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

    include_buckets = _empty_geo_buckets()
    exclude_buckets = _empty_geo_buckets()
    resolved: List[Dict[str, Any]] = []
    errors: List[str] = []

    for spec in specs:
        row = _resolve_one(access_token, spec=spec, api_version=api_version)
        if not row:
            errors.append(f'Could not resolve location: {spec.name}')
            continue
        resolved.append(row)
        target = exclude_buckets if spec.role == 'exclude' else include_buckets
        _append_meta_location(target, row)

    def _compact(buckets: Dict[str, List[Any]]) -> Dict[str, Any]:
        return {k: v for k, v in buckets.items() if v}

    geo_locations = _compact(include_buckets)
    excluded_geo_locations = _compact(exclude_buckets)

    if not geo_locations and not excluded_geo_locations:
        return {
            'ok': False,
            'error': '; '.join(errors) if errors else 'No locations resolved',
            'errors': errors,
        }

    summary = intent.summary if intent else ''
    return {
        'ok': True,
        'geo_locations': geo_locations,
        'excluded_geo_locations': excluded_geo_locations,
        'resolved': resolved,
        'summary': summary,
        'errors': errors,
    }
