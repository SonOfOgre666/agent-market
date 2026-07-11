"""Tests for dynamic geo targeting intent and resolution."""

from __future__ import annotations

from lib.planner.geo_targeting_intent import (
    GeoLocationSpec,
    GeoTargetingIntent,
    _legacy_geo_intent,
    merge_geo_intent_with_llm_countries,
    normalize_geo_location_spec,
    sanitize_geo_location_name,
)
from lib.planner.geo_targeting_resolve import pick_best_google_result, pick_best_meta_result


def test_geo_intent_from_llm_block():
    intent = GeoTargetingIntent.from_llm_fields({
        'geo_targeting': {
            'include': [{'name': 'Morocco', 'type': 'country'}],
            'exclude': [{'name': 'Casablanca', 'type': 'city', 'country_context': 'MA'}],
            'summary': 'Morocco excluding Casablanca',
        },
    })
    assert intent is not None
    assert len(intent.include) == 1
    assert len(intent.exclude) == 1
    assert intent.exclude[0].name == 'Casablanca'


def test_legacy_morocco_intent():
    intent = _legacy_geo_intent('target Morocco $25/day', None)
    assert intent is not None
    assert intent.has_locations()
    assert intent.include[0].location_type == 'country'


def test_legacy_exclude_casablanca():
    prompt = (
        'Search campaign on google ads targeting Morocco and France, '
        'exclude Casablanca, $7/day'
    )
    intent = _legacy_geo_intent(prompt, None)
    assert intent is not None
    assert any(x.name == 'Casablanca' for x in intent.exclude)
    assert 'excluding' in intent.summary.lower()


def test_merge_llm_countries():
    intent = merge_geo_intent_with_llm_countries(None, ['MA', 'FR'])
    assert intent is not None
    assert len(intent.include) == 2


def test_pick_best_google_country():
    spec = GeoLocationSpec(name='Morocco', location_type='country', role='include')
    results = [
        {'geo_target_constant_id': 2490, 'name': 'Wrong Place', 'target_type': 'City', 'country_code': 'MA'},
        {'geo_target_constant_id': 2504, 'name': 'Morocco', 'target_type': 'Country', 'country_code': 'MA'},
    ]
    picked = pick_best_google_result(spec, results)
    assert picked is not None
    assert picked['geo_target_constant_id'] == 2504


def test_pick_best_meta_city():
    spec = GeoLocationSpec(name='Casablanca', location_type='city', role='include', country_context='MA')
    results = [
        {'key': '1', 'name': 'Casablanca, Missouri', 'type': 'city', 'country_code': 'US'},
        {'key': '2420605', 'name': 'Casablanca, Morocco', 'type': 'city', 'country_code': 'MA'},
    ]
    picked = pick_best_meta_result(spec, results)
    assert picked is not None
    assert picked['key'] == '2420605'


def test_geo_intent_payload_roundtrip():
    intent = GeoTargetingIntent(
        include=[GeoLocationSpec(name='France', location_type='country')],
        exclude=[GeoLocationSpec(name='Paris', location_type='city', country_context='FR')],
        summary='France excluding Paris',
    )
    restored = GeoTargetingIntent.from_payload(intent.to_payload())
    assert restored is not None
    assert len(restored.include) == 1
    assert len(restored.exclude) == 1


def test_sanitize_marrakech_polluted_name():
    spec = normalize_geo_location_spec(
        GeoLocationSpec(name='marrakech google ads Display make it just 4'),
    )
    assert spec.name == 'Marrakech'
    assert spec.country_context == 'MA'
    assert spec.location_type == 'city'


def test_legacy_in_marrakech_stops_at_google_ads():
    intent = _legacy_geo_intent('tourist in marrakech google ads display', None)
    assert intent is not None
    assert intent.include[0].name == 'Marrakech'
    assert 'google' not in intent.include[0].name.lower()


def test_legacy_finds_marrakech_in_conversation():
    prompt = (
        'i want to launch an ad about tourist in marrakech google ads\n'
        'Display\nmake it just 4$/day'
    )
    intent = _legacy_geo_intent(prompt, None)
    assert intent is not None
    assert intent.include[0].name == 'Marrakech'
    assert intent.include[0].country_context == 'MA'
    assert intent.display_label() == 'Marrakech'


def test_resolve_iso_country_fast_path():
    from connectors.google_ads.geo_resolve import _resolve_one

    row = _resolve_one(
        {},
        customer_id='123',
        spec=GeoLocationSpec(
            name='Morocco',
            location_type='country',
            role='include',
            country_context='MA',
        ),
    )
    assert row is not None
    assert row['geo_target_constant_id'] == 2504
    assert row['target_type'] == 'Country'
