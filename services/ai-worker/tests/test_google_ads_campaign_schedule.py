"""Tests for Google Ads campaign schedule formatting."""

from __future__ import annotations

from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from connectors.google_ads.campaigns import _apply_campaign_schedule


class _Campaign:
    start_date_time: str | None = None
    end_date_time: str | None = None


def test_omits_start_when_today_midnight_already_passed_in_account_tz():
    campaign = _Campaign()
    tz = ZoneInfo('Africa/Casablanca')
    afternoon = datetime(2026, 7, 7, 15, 46, tzinfo=tz)

    with patch('connectors.google_ads.campaigns._schedule_now', return_value=afternoon):
        _apply_campaign_schedule(
            campaign,
            '2026-07-07',
            '2026-07-15',
            schedule_timezone='Africa/Casablanca',
        )

    assert campaign.start_date_time is None
    assert campaign.end_date_time == '2026-07-15 23:59:59'


def test_future_start_uses_midnight_in_account_tz():
    campaign = _Campaign()
    tz = ZoneInfo('Africa/Casablanca')
    afternoon = datetime(2026, 7, 7, 15, 46, tzinfo=tz)

    with patch('connectors.google_ads.campaigns._schedule_now', return_value=afternoon):
        _apply_campaign_schedule(
            campaign,
            '2026-07-08',
            '2026-07-15',
            schedule_timezone='Africa/Casablanca',
        )

    assert campaign.start_date_time == '2026-07-08 00:00:00'
    assert campaign.end_date_time == '2026-07-15 23:59:59'


def test_past_start_day_bumps_to_today_then_omits_if_midnight_passed():
    campaign = _Campaign()
    tz = ZoneInfo('Africa/Casablanca')
    afternoon = datetime(2026, 7, 7, 15, 46, tzinfo=tz)

    with patch('connectors.google_ads.campaigns._schedule_now', return_value=afternoon):
        _apply_campaign_schedule(
            campaign,
            '2026-07-05',
            '2026-07-15',
            schedule_timezone='Africa/Casablanca',
        )

    assert campaign.start_date_time is None
    assert campaign.end_date_time == '2026-07-15 23:59:59'


def test_same_day_start_and_end_is_valid():
    campaign = _Campaign()
    tz = ZoneInfo('UTC')
    morning = datetime(2026, 7, 7, 8, 0, tzinfo=tz)

    with patch('connectors.google_ads.campaigns._schedule_now', return_value=morning):
        _apply_campaign_schedule(
            campaign,
            '2026-07-08',
            '2026-07-08',
            schedule_timezone='UTC',
        )

    assert campaign.start_date_time == '2026-07-08 00:00:00'
    assert campaign.end_date_time == '2026-07-08 23:59:59'
