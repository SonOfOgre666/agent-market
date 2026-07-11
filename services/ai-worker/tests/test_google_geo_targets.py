"""Google Ads country geo target constant IDs."""

from lib.google_geo_targets import (
    GOOGLE_GEO_BY_ISO,
    geo_target_id_for_iso,
    geo_target_ids_for_iso_codes,
)
from lib.planner.google_campaign_spec import resolve_geo_target_ids


def test_morocco_is_2504_not_legacy_wrong_id():
    assert GOOGLE_GEO_BY_ISO['MA'] == 2504
    assert geo_target_id_for_iso('MA') == 2504


def test_common_countries_match_google_geotargets():
    assert GOOGLE_GEO_BY_ISO['US'] == 2840
    assert GOOGLE_GEO_BY_ISO['FR'] == 2250
    assert GOOGLE_GEO_BY_ISO['DE'] == 2276
    assert GOOGLE_GEO_BY_ISO['GB'] == 2826
    assert GOOGLE_GEO_BY_ISO['CA'] == 2124
    assert GOOGLE_GEO_BY_ISO['TN'] == 2788
    assert GOOGLE_GEO_BY_ISO['DZ'] == 2012


def test_multi_country_iso_resolution():
    ids, missing = geo_target_ids_for_iso_codes(['MA', 'FR', 'ES'])
    assert missing == []
    assert ids == [2504, 2250, 2724]


def test_multi_country_dedupes_same_id():
    ids, missing = geo_target_ids_for_iso_codes(['MA', 'ma'])
    assert missing == []
    assert ids == [2504]


def test_resolve_geo_target_ids_morocco_prompt():
    ids = resolve_geo_target_ids('target Morocco $25/day until 2026-08-01')
    assert ids == [2504]


def test_resolve_geo_target_ids_multi_country_prompt():
    ids = resolve_geo_target_ids('target Morocco and France and Spain')
    assert ids == [2504, 2250, 2724]


def test_country_label_for_iso():
    from lib.google_geo_targets import country_label_for_iso

    assert country_label_for_iso('MA') == 'Morocco'
    assert country_label_for_iso('FR') == 'France'
