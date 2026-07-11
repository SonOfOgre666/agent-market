"""Spec-driven missing-parameter collection."""

from lib.planner.workflow_collect import compute_google_missing, compute_meta_missing


def test_google_search_missing_budget_and_end_date():
    missing = compute_google_missing(
        campaign_type='search',
        budget=None,
        end_date=None,
        geo_ids=[2124],
        geo_query=None,
        geo_countries=['MA'],
        final_url='https://shop.example.com',
        keywords=None,
        merchant_id=None,
        auto_merchant=False,
        app_id=None,
        youtube_video_id=None,
        has_image=False,
        business_inferable=True,
    )
    names = {m.name for m in missing}
    assert 'daily_budget' in names
    assert 'end_date' in names
    assert 'business_context' not in names


def test_google_vague_business_needs_context():
    missing = compute_google_missing(
        campaign_type='search',
        budget=20.0,
        end_date='2026-08-01',
        geo_ids=[2124],
        geo_query=None,
        geo_countries=['MA'],
        final_url='https://shop.example.com',
        keywords=None,
        merchant_id=None,
        auto_merchant=False,
        app_id=None,
        youtube_video_id=None,
        has_image=False,
        business_inferable=False,
    )
    assert any(m.name == 'business_context' for m in missing)


def test_meta_traffic_missing_end_time():
    missing = compute_meta_missing(
        objective='OUTCOME_TRAFFIC',
        branch='single_image',
        image_video_ambiguous=False,
        pages=[{'id': 'p1', 'name': 'Page'}],
        page_ids=['p1'],
        geo=['MA'],
        budget=20.0,
        end_time=None,
        link_url='https://shop.example.com',
        lead_form_id=None,
        app_id=None,
        store_url=None,
        dsa_required=False,
        dsa_beneficiary=None,
        dsa_payor=None,
        sales_blocked_no_pixel=False,
        has_image=True,
        has_video=False,
    )
    assert any(m.name == 'end_time' for m in missing)
