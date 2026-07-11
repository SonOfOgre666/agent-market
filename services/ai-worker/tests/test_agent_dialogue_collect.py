"""Collect prompts include parameter hints (especially Google campaign types)."""

from lib.planner.agent_dialogue import render_agent_message
from lib.planner.workflow_collect import MissingParameter


def test_collect_fallback_lists_campaign_type_options():
    msg = render_agent_message(
        workspace_id=None,
        phase='collect',
        workflow_label='Google Ads campaign',
        missing=[
            MissingParameter(
                'campaign_type',
                'Campaign type',
                'Search, Display, Video, Shopping, Performance Max, App, or Local?',
            ),
            MissingParameter('daily_budget', 'Daily budget', 'e.g. $25/day (minimum $1)'),
        ],
        use_llm=False,
    )
    assert 'Search, Display, Video' in msg
    assert 'Performance Max' in msg
    assert '1.' in msg
    assert 'Campaign type' in msg
