"""Tests for SPEC_META_ADS_AI_AGENT.md planner (meta_campaign_spec)."""

from __future__ import annotations

from unittest.mock import patch

from lib.planner.meta_campaign_spec import (
    build_cbo_execute_steps,
    compile_meta_campaign,
    extract_daily_budget,
    extract_end_time_iso,
    is_meta_campaign_approval,
    meta_objective_from_prompt,
    plan_meta_create_workflow,
    resolve_branch,
    resolve_geo_countries,
    resolve_meta_objective,
)


def test_resolve_geo_no_silent_us_default():
    assert resolve_geo_countries('create traffic ads') is None
    assert resolve_geo_countries('target Morocco') == ['MA']


def test_objective_not_defaulted_without_signal():
    assert meta_objective_from_prompt('Create meta ads for Morocco $25/day until Aug 1') is None
    assert meta_objective_from_prompt('Promote my brand in Morocco') is None


def test_resolve_objective_infers_brand_awareness():
    objective, source = resolve_meta_objective('Promote my brand in Morocco $20/day until 2026-08-01')
    assert objective == 'OUTCOME_AWARENESS'
    assert source == 'inferred'


def test_resolve_objective_asks_when_very_unclear():
    objective, source = resolve_meta_objective(
        'Create meta ads for Morocco $20/day until 2026-08-01 '
        'https://shop.example.com/product.jpg https://shop.example.com'
    )
    assert objective is None
    assert source == 'unclear'


def test_objective_inferred_when_explicit():
    assert meta_objective_from_prompt('Create meta traffic ads Morocco') == 'OUTCOME_TRAFFIC'
    assert meta_objective_from_prompt('awareness campaign Morocco') == 'OUTCOME_AWARENESS'
    assert meta_objective_from_prompt('OUTCOME_ENGAGEMENT') == 'OUTCOME_ENGAGEMENT'
    assert meta_objective_from_prompt('Traffic') == 'OUTCOME_TRAFFIC'


@patch('lib.planner.meta_campaign_spec.fetch_usable_pages')
def test_plan_asks_objective_when_unclear(mock_pages):
    mock_pages.return_value = [{'id': 'p1', 'name': 'My Page'}]
    prompt = (
        'Create meta ads for Morocco $20/day until 2026-08-01 '
        'https://shop.example.com/product.jpg https://shop.example.com'
    )
    ctx = {
        'attached_media': [{'id': 'img1', 'mime_type': 'image/jpeg'}],
        'conversation_history': [],
    }
    graph = plan_meta_create_workflow(
        prompt=prompt,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='Test Campaign',
    )
    assert graph['intent'] == 'informational'
    assert graph['steps'] == []
    assert 'Campaign objective' in graph['assistant_message']


def test_extract_budget_and_end_date():
    assert extract_daily_budget('budget $25/day for supplements') == 25.0
    assert extract_end_time_iso('run until 2026-07-15') == '2026-07-15T23:59:59+0000'


def test_branch_resolution_image_attachment():
    ctx = {'attached_media': [{'id': 'm1', 'mime_type': 'image/png'}]}
    branch, amb = resolve_branch('OUTCOME_AWARENESS', ctx, 'awareness ads Morocco')
    assert branch == 'single_image'
    assert amb is False


def test_branch_ambiguous_without_media():
    branch, amb = resolve_branch('OUTCOME_AWARENESS', {}, 'awareness ads Morocco')
    assert branch is None
    assert amb is True


def test_sales_auto_single_image():
    branch, amb = resolve_branch('OUTCOME_SALES', {}, 'sales campaign')
    assert branch == 'single_image'
    assert amb is False


def test_approval_requires_prior_review():
    history = [
        {'role': 'assistant', 'content': 'Campaign Review\nApprove and spend up to $750?'},
    ]
    assert is_meta_campaign_approval('APPROVE', history) is True
    assert is_meta_campaign_approval('looks good', history) is False


def test_cbo_step_order():
    from lib.planner.meta_campaign_spec import MetaCampaignCompiled

    compiled = MetaCampaignCompiled(
        name='Test',
        objective='OUTCOME_TRAFFIC',
        branch='single_image',
        budget_amount=25,
        end_time='2026-07-15T23:59:59+0000',
        geo_countries=['MA'],
        page_ids=['123'],
        page_names=['Page'],
        link_url='https://shop.example.com',
        media_id='media1',
        message='Hi',
        headline='Head',
        description='Desc',
        estimated_max_spend=750,
        day_count=30,
    )
    steps = build_cbo_execute_steps({'account_id': 'acc1'}, compiled)
    tools = [s['tool_id'] for s in steps]
    assert tools.index('meta_create_campaign') < tools.index('meta_create_adset')
    assert tools.index('meta_create_adset') < tools.index('meta_upload_ad_image')
    assert tools.index('meta_upload_ad_image') < tools.index('meta_create_creative')
    assert tools.index('meta_create_creative') < tools.index('meta_create_ad')

    campaign = next(s for s in steps if s['tool_id'] == 'meta_create_campaign')
    assert campaign['payload']['use_adset_level_budgets'] is False
    assert campaign['payload']['budget']['amount'] == 25

    adset = next(s for s in steps if s['tool_id'] == 'meta_create_adset')
    assert adset['payload'].get('cbo_parent') is True
    assert 'daily_budget' not in adset['payload']


_MOCK_COPY = ('Shop now for the best deals.', 'Shop Today', 'Quality products.', 'llm')


@patch('lib.planner.meta_campaign_spec.resolve_meta_ad_copy', return_value=_MOCK_COPY)
@patch('lib.planner.meta_campaign_spec.fetch_usable_pages')
def test_plan_shows_review_before_steps(mock_pages, _mock_copy):
    mock_pages.return_value = [{'id': 'p1', 'name': 'My Page'}]
    prompt = (
        'Create meta traffic ads for Morocco $20/day until 2026-08-01 '
        'https://shop.example.com/product.jpg https://shop.example.com'
    )
    ctx = {
        'attached_media': [{'id': 'img1', 'mime_type': 'image/jpeg'}],
        'conversation_history': [],
    }
    graph = plan_meta_create_workflow(
        prompt=prompt,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='Test Campaign',
    )
    assert graph['intent'] == 'informational'
    assert graph['steps'] == []
    assert graph.get('requires_approval') is True
    assert 'APPROVE' in graph['assistant_message']
    assert graph.get('meta_compiled') or '2026-08-01' in graph['assistant_message']


def test_materialize_meta_compiled_graph():
    from lib.planner.meta_campaign_spec import MetaCampaignCompiled, materialize_meta_compiled_graph

    compiled = MetaCampaignCompiled(
        name='T', objective='OUTCOME_TRAFFIC', branch='single_image', budget_amount=20,
        end_time='2026-08-01T23:59:59+0000', geo_countries=['MA'], page_ids=['p1'],
        page_names=['Page'], link_url='https://shop.com', media_id='m1',
        message='Hi', headline='H', estimated_max_spend=100, day_count=10,
    )
    graph = materialize_meta_compiled_graph(
        {'meta_compiled': compiled.__dict__, 'meta_setup_phase': 'ready_for_review'},
        account_id='acc1',
        workspace_id='ws1',
    )
    assert len(graph['steps']) >= 5
    assert graph['intent'] == 'ads_campaign'


@patch('lib.planner.meta_campaign_spec.resolve_meta_ad_copy', return_value=_MOCK_COPY)
@patch('lib.planner.meta_campaign_spec.fetch_usable_pages')
def test_plan_executes_after_approve(mock_pages, _mock_copy):
    mock_pages.return_value = [{'id': 'p1', 'name': 'My Page'}]
    ctx = {
        'attached_media': [{'id': 'img1', 'mime_type': 'image/jpeg'}],
        'conversation_history': [
            {
                'role': 'user',
                'content': (
                    'Create meta traffic ads Morocco $20/day until 2026-08-01 '
                    'https://shop.example.com/product.jpg https://shop.example.com'
                ),
            },
            {
                'role': 'assistant',
                'content': 'Campaign Review\nApprove and spend up to $100?\nType APPROVE to continue.',
            },
        ],
    }
    merged = (
        'Create meta traffic ads Morocco $20/day until 2026-08-01 '
        'https://shop.example.com/product.jpg https://shop.example.com\n\nAPPROVE'
    )
    graph = plan_meta_create_workflow(
        prompt=merged,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='Test Campaign',
    )
    assert graph['intent'] == 'ads_campaign'
    assert len(graph['steps']) >= 5
