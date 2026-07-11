"""Tests for Google Ads agent planner (google_campaign_spec)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from lib.planner.google_campaign_spec import (
    build_google_execute_steps,
    extract_keywords,
    google_campaign_type_from_prompt,
    infer_business_context,
    is_business_inferable,
    is_google_campaign_approval,
    plan_google_create_workflow,
    resolve_campaign_status,
    resolve_google_geo,
    resolve_geo_target_ids,
)
from lib.planner.google_keyword_pipeline import (
    KeywordPipelineResult,
    emergency_keyword_seeds,
)
from lib.planner.meta_campaign_spec import extract_end_time_iso


def _mock_llm_keywords(**_kwargs):
    return ['whey protein morocco', 'creatine supplements', 'mass gainer', 'protein powder']


def _mock_llm_copy(**_kwargs):
    return (
        ['Fitness Store — Shop Now', 'Premium Supplements', 'Fast Morocco Delivery'],
        ['Order quality supplements online with secure checkout.', 'Fuel your training today.'],
    )


def test_google_type_detection():
    assert google_campaign_type_from_prompt('Create a search campaign') == 'search'
    assert google_campaign_type_from_prompt('Performance Max for leads') == 'performance_max'
    assert google_campaign_type_from_prompt('shopping ads with merchant') == 'shopping'


def test_google_type_from_collection_reply_line():
    merged = (
        'Create a google advertising setup for fitness supplements targeting Morocco.\n\n'
        'Search\n\n1$\n\nend after 9 days'
    )
    assert google_campaign_type_from_prompt(merged) == 'search'
    assert google_campaign_type_from_prompt('Display') == 'display'
    assert google_campaign_type_from_prompt('pmax') == 'performance_max'


def test_google_type_typo_searh_campaign():
    assert google_campaign_type_from_prompt('Searh campaign') == 'search'
    assert google_campaign_type_from_prompt('searh campaign\n7$') == 'search'


def test_resolve_geo_morocco():
    ids = resolve_geo_target_ids('target Morocco $25/day until 2026-08-01')
    assert ids == [2504]


def test_geo_city_query_for_execute():
    ids, query, _countries = resolve_google_geo('search ads in Casablanca $20/day until 2026-08-01')
    assert ids is None
    assert query == 'Casablanca'


def test_targeting_quoted_keyword():
    assert extract_keywords('targeting "gym Casablanca"') == ['gym Casablanca']


def test_status_defaults_paused():
    assert resolve_campaign_status('create search campaign') == 'PAUSED'
    assert resolve_campaign_status('create enabled search campaign') == 'ENABLED'


def test_approval_requires_prior_review():
    history = [
        {'role': 'assistant', 'content': 'Google Campaign Review\nType APPROVE to continue.'},
    ]
    assert is_google_campaign_approval('APPROVE', history) is True
    assert is_google_campaign_approval('looks good', history) is False


def test_infer_business_context_from_prompt():
    assert infer_business_context(
        'Create a Search campaign for my fitness supplement store targeting Morocco'
    ) == 'fitness supplement store'
    assert infer_business_context(
        'Create a google advertising setup for fitness supplements targeting Morocco.'
    ) == 'fitness supplements'


def test_emergency_keyword_seeds_are_generic_not_vertical():
    kws = emergency_keyword_seeds(
        business_context='fitness supplement store',
        geo_countries=['MA'],
    )
    assert 'whey protein' not in kws
    assert any('fitness supplement store' in k.lower() for k in kws)
    assert any('morocco' in k.lower() for k in kws)


def test_fitness_prompt_does_not_ask_for_keywords():
    prompt = 'Create a Google Search campaign for my fitness supplement store targeting Morocco'
    ctx = {'attached_media': [], 'conversation_history': []}
    assert is_business_inferable(prompt, 'search') is True
    graph = plan_google_create_workflow(
        prompt=prompt,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='Fitness Supplements',
    )
    assert graph['intent'] == 'informational'
    msg = graph['assistant_message']
    assert 'budget' in msg.lower()
    assert 'end date' in msg.lower()
    assert 'landing' in msg.lower() or 'final url' in msg.lower()
    assert 'auto-generated' in msg.lower() or 'generate' in msg.lower()


def test_vague_business_asks_intent_not_keywords():
    prompt = 'Create a Google Search campaign for my business targeting Morocco'
    ctx = {'attached_media': [], 'conversation_history': []}
    graph = plan_google_create_workflow(
        prompt=prompt,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='My Campaign',
    )
    assert 'promote' in graph['assistant_message'].lower()


@patch('lib.planner.google_campaign_spec.generate_rsa_copy_with_llm', side_effect=_mock_llm_copy)
@patch('lib.planner.google_keyword_pipeline.generate_seed_keywords_with_llm', side_effect=_mock_llm_keywords)
@patch('lib.planner.google_keyword_pipeline._try_google_planner', return_value=None)
def test_review_shows_ai_generated_keywords(_planner, _kw_llm, _copy_llm):
    prompt = (
        'Create google search campaign for my fitness supplement store Morocco '
        '$20/day until 2026-08-01 https://shop.example.com'
    )
    ctx = {'attached_media': [], 'conversation_history': []}
    graph = plan_google_create_workflow(
        prompt=prompt,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='Fitness Store',
    )
    assert 'Generated keywords' in graph['assistant_message']
    assert 'whey protein morocco' in graph['assistant_message']
    assert 'REMOVE <keyword>' in graph['assistant_message']
    assert graph['google_compiled']['keyword_source'] == 'llm'


def test_plan_asks_for_end_date():
    prompt = 'Create google search campaign for Morocco $20/day https://shop.example.com keywords: fitness'
    ctx = {'attached_media': [], 'conversation_history': []}
    graph = plan_google_create_workflow(
        prompt=prompt,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='Test Campaign',
    )
    assert graph['intent'] == 'informational'
    assert 'End date' in graph['assistant_message']


def test_end_after_relative_days_parsed():
    end = extract_end_time_iso('8$ per day end after 2 days https://example.com')
    assert end
    expected = datetime.now(timezone.utc) + timedelta(days=2)
    assert end.startswith(expected.strftime('%Y-%m-%d'))


@patch('lib.planner.google_campaign_spec.generate_rsa_copy_with_llm', side_effect=_mock_llm_copy)
@patch('lib.planner.google_keyword_pipeline.generate_seed_keywords_with_llm', side_effect=_mock_llm_keywords)
@patch('lib.planner.google_keyword_pipeline._try_google_planner', return_value=None)
@patch('lib.planner.google_campaign_spec.extract_google_campaign_fields_with_llm', return_value=None)
def test_multiturn_end_after_two_days(_llm_fields, _planner, _kw_llm, _copy_llm):
    history = [
        {
            'role': 'user',
            'content': 'Create a Google Search campaign for my fitness supplement store targeting Morocco',
        },
        {'role': 'assistant', 'content': 'Google Campaign Setup — still need budget, end date, URL.'},
    ]
    prompt = (
        '8$\n\nend after 2 days\n\n'
        'https://roots-wishing-examination-naples.trycloudflare.com/agent'
    )
    ctx = {'attached_media': [], 'conversation_history': history}
    graph = plan_google_create_workflow(
        prompt=prompt,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='Fitness Supplements',
    )
    assert graph.get('google_setup_phase') == 'ready_for_review'
    compiled = graph['google_compiled']
    assert compiled['budget_amount'] == 8
    assert compiled['final_url'].startswith('https://')
    assert compiled['end_date']
    assert 'still need' not in graph['assistant_message'].lower()
    assert 'I still need' not in graph['assistant_message']


def test_plan_shows_review_before_execute():
    prompt = (
        'Create google search campaign for Morocco $20/day until 2026-08-01 '
        'https://shop.example.com '
        'keywords: fitness supplements, protein powder'
    )
    ctx = {'attached_media': [], 'conversation_history': []}
    graph = plan_google_create_workflow(
        prompt=prompt,
        ctx=ctx,
        base_payload={'account_id': 'acc1'},
        name='Fitness Search',
    )
    assert graph['intent'] == 'informational'
    assert graph.get('google_compiled')
    assert 'APPROVE' in graph['assistant_message']
    assert '2026-08-01' in graph['assistant_message']
    assert graph['steps'] == []


def test_plan_execute_after_approve():
    history = [
        {
            'role': 'user',
            'content': (
                'Create google search campaign Morocco $20/day until 2026-08-01 '
                'https://shop.example.com keywords: fitness, protein'
            ),
        },
        {'role': 'assistant', 'content': 'Google Campaign Review\nType APPROVE to continue.'},
    ]
    graph = plan_google_create_workflow(
        prompt='APPROVE',
        ctx={'attached_media': [], 'conversation_history': history},
        base_payload={'account_id': 'acc1'},
        name='Fitness Search',
    )
    assert graph['intent'] == 'ads_campaign'
    publish_steps = [s for s in graph['steps'] if s['tool_id'].startswith('google_publish_')]
    assert len(publish_steps) == 1
    assert publish_steps[0]['tool_id'] == 'google_publish_search_campaign'
    assert publish_steps[0]['payload']['end_date'] == '2026-08-01'


def test_execute_steps_geo_resolve_for_city():
    from lib.planner.geo_targeting_intent import GeoLocationSpec, GeoTargetingIntent
    from lib.planner.google_campaign_spec import GoogleCampaignCompiled

    compiled = GoogleCampaignCompiled(
        name='Gym Search',
        campaign_type='search',
        budget_amount=20,
        geo_target_constant_ids=[],
        geo_countries=[],
        geo_query='Casablanca',
        geo_intent=GeoTargetingIntent(
            include=[GeoLocationSpec(name='Casablanca', location_type='city', country_context='MA')],
            summary='Casablanca',
        ),
        needs_geo_resolve=True,
        end_date='2026-08-01',
        final_url='https://gym.example.com',
        keywords=['gym Casablanca'],
    )
    steps = build_google_execute_steps({'account_id': 'acc1'}, compiled)
    tools = [s['tool_id'] for s in steps]
    assert 'google_resolve_geo_targeting' in tools
    publish = next(s for s in steps if s['tool_id'] == 'google_publish_search_campaign')
    assert 'geo_target_constant_ids' in publish['payload']


def test_execute_steps_shopping_auto_merchant():
    from lib.planner.google_campaign_spec import GoogleCampaignCompiled

    compiled = GoogleCampaignCompiled(
        name='Shop',
        campaign_type='shopping',
        budget_amount=30,
        geo_target_constant_ids=[2504],
        geo_countries=['MA'],
        end_date='2026-08-01',
        auto_merchant=True,
    )
    steps = build_google_execute_steps({'account_id': 'acc1'}, compiled)
    tools = [s['tool_id'] for s in steps]
    assert 'google_list_merchant_centers' in tools


def test_compiled_from_graph_restores_geo_intent_for_approve():
    from dataclasses import asdict

    from lib.planner.geo_targeting_intent import GeoLocationSpec, GeoTargetingIntent
    from lib.planner.google_campaign_spec import (
        GoogleCampaignCompiled,
        compiled_from_graph,
        materialize_google_compiled_graph,
    )

    geo = GeoTargetingIntent(
        include=[
            GeoLocationSpec(name='Morocco', location_type='country', role='include'),
            GeoLocationSpec(name='France', location_type='country', role='include'),
        ],
        exclude=[
            GeoLocationSpec(
                name='Casablanca',
                location_type='city',
                role='exclude',
                country_context='MA',
            ),
        ],
        summary='Morocco and France, excluding Casablanca',
    )
    compiled = GoogleCampaignCompiled(
        name='New campaign',
        campaign_type='search',
        budget_amount=7.0,
        geo_target_constant_ids=[],
        geo_countries=['MA', 'FR'],
        final_url='https://www.prodietnutrition.ma/fr/',
        geo_intent=geo,
        needs_geo_resolve=True,
        end_date='2026-07-02',
    )
    graph = {
        'google_setup_phase': 'ready_for_review',
        'google_compiled': asdict(compiled),
    }
    restored = compiled_from_graph(graph)
    assert restored is not None
    assert restored.geo_intent is not None
    assert restored.geo_intent.exclude
    assert hasattr(restored.geo_intent, 'to_payload')

    materialized = materialize_google_compiled_graph(
        graph,
        account_id='1190848329',
        workspace_id='ws1',
    )
    geo_step = next(s for s in materialized['steps'] if s['tool_id'] == 'google_resolve_geo_targeting')
    assert geo_step['payload']['exclude']
