"""Tests for agent-published campaign persistence."""

from __future__ import annotations

from dataclasses import asdict
from unittest.mock import patch

from lib.ads_agent_persist import _find_publish_output, persist_agent_campaign_from_workflow
from lib.planner.google_campaign_spec import GoogleCampaignCompiled


def _compiled() -> GoogleCampaignCompiled:
    return GoogleCampaignCompiled(
        name='Marrakech Search',
        campaign_type='search',
        budget_amount=2.0,
        geo_target_constant_ids=[2504],
        geo_countries=['MA'],
        final_url='https://www.geeksforgeeks.org/devops/devops-roadmap',
        keywords=['devops roadmap'],
        headlines=['Marrakech Tourist Ad'],
        descriptions=['Plan your trip'],
        end_date='2026-07-15',
        start_date='2026-07-07',
        currency='MAD',
        status='PAUSED',
    )


def test_find_publish_output_from_google_search_step():
    graph = {
        'steps': [
            {'step_id': 'step_1', 'tool_id': 'google_get_account'},
            {'step_id': 'step_3', 'tool_id': 'google_publish_search_campaign'},
        ],
    }
    step_results = {
        'step_3': {
            'status': 'completed',
            'output': {
                'ok': True,
                'platform_campaign_id': '24014357224',
                'platform_ad_set_id': '198080266253',
            },
        },
    }
    out = _find_publish_output(graph, step_results)
    assert out is not None
    assert out['platform_campaign_id'] == '24014357224'


def test_persist_agent_campaign_from_workflow_calls_worker_api():
    graph = {
        'google_compiled': asdict(_compiled()),
        'google_account_id': 'acc-1',
        'steps': [
            {'step_id': 'step_3', 'tool_id': 'google_publish_search_campaign'},
        ],
    }
    step_results = {
        'step_3': {
            'status': 'completed',
            'output': {
                'ok': True,
                'platform_campaign_id': '24014357224',
            },
        },
    }
    with patch('lib.ads_agent_persist.worker_api.configured', return_value=True), patch(
        'lib.ads_agent_persist.worker_api.persist_agent_published_campaign',
        return_value={'ok': True, 'created': True, 'campaign_id': 'mongo1'},
    ) as persist:
        result = persist_agent_campaign_from_workflow(
            workspace_id='ws-1',
            graph=graph,
            step_results=step_results,
        )
    assert result == {'ok': True, 'created': True, 'campaign_id': 'mongo1'}
    body = persist.call_args[0][0]
    assert body['workspace_id'] == 'ws-1'
    assert body['platform'] == 'google_ads'
    assert body['platform_campaign_id'] == '24014357224'
    assert body['status'] == 'paused'
    assert body['budget']['amount'] == 2.0
