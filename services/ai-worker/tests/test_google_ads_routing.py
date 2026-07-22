"""Ads helper detectors still exist for follow-up merge / legacy tests — not used for planner catalog routing."""

from __future__ import annotations

from lib.planner.ads_helpers import detect_ads_platform, is_actionable_ads_request


def test_google_advertising_setup_is_actionable():
    msg = 'Create a google advertising setup for fitness supplements targeting Morocco.'
    assert is_actionable_ads_request(msg) is True
    assert detect_ads_platform(msg, {'ads_accounts': []}) == 'google_ads'


def test_meta_ads_detected():
    msg = 'Launch a Meta campaign for skincare products'
    assert is_actionable_ads_request(msg) is True
    assert detect_ads_platform(msg, {'ads_accounts': []}) == 'meta_ads'


def test_non_ads_message():
    msg = 'Create a social post about our new product'
    assert is_actionable_ads_request(msg) is False
