"""Google manager account publish customer resolution."""

from lib.planner.google_campaign_spec import build_publish_payload, GoogleCampaignCompiled
from connectors.google_ads.accounts import resolve_google_publish_customer


def test_resolve_publish_customer_for_client_account():
    out = resolve_google_publish_customer(
        {},
        customer_id='1234567890',
        manager=False,
        status='ENABLED',
    )
    assert out['publish_customer_id'] == '1234567890'
    assert out['account_role'] == 'client'


def test_resolve_publish_customer_blocks_closed_account():
    out = resolve_google_publish_customer(
        {},
        customer_id='1234567890',
        manager=False,
        status='CLOSED',
    )
    assert out['publish_customer_id'] is None
    assert 'CLOSED' in (out.get('publish_block_reason') or '')


def test_resolve_publish_customer_allows_closed_test_account():
    out = resolve_google_publish_customer(
        {},
        customer_id='9333593486',
        manager=False,
        status='CLOSED',
        test_account=True,
    )
    assert out['publish_customer_id'] == '9333593486'
    assert out.get('publish_block_reason') is None


def test_publish_payload_uses_resolved_customer_from_account_step():
    compiled = GoogleCampaignCompiled(
        name='Test',
        campaign_type='search',
        budget_amount=10.0,
        geo_target_constant_ids=[2504],
        geo_countries=['MA'],
        final_url='https://example.com',
        keywords=['a', 'b'],
        headlines=['h1', 'h2', 'h3'],
        descriptions=['d1', 'd2'],
    )
    payload = build_publish_payload(
        {'account_id': 'acc1'},
        compiled,
        account_step='step_1',
    )
    assert payload['customer_id'] == '$step_1.output.publish_customer_id'
