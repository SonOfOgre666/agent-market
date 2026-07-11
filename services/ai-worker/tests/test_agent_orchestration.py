"""Tests for agent orchestration layer."""

from __future__ import annotations

from lib.planner.agent_dialogue import render_planner_dialogue
from lib.planner.workflow_spec import (
    GOOGLE_WORKFLOW_SPECS,
    META_WORKFLOW_SPECS,
    WORKFLOW_REGISTRY,
    google_workflow_id_for_type,
    meta_workflow_id_for_objective,
)


def test_all_google_campaign_types_have_specs():
    for campaign_type in (
        'search', 'display', 'video', 'shopping', 'performance_max', 'app', 'local',
    ):
        wf_id = google_workflow_id_for_type(campaign_type)
        assert wf_id in GOOGLE_WORKFLOW_SPECS
        spec = GOOGLE_WORKFLOW_SPECS[wf_id]
        assert spec.campaign_type == campaign_type
        assert 'daily_budget' in spec.required_names()
        assert 'end_date' in spec.required_names()


def test_shopping_has_no_final_url_requirement():
    spec = GOOGLE_WORKFLOW_SPECS['google_shopping_create']
    assert 'final_url' not in spec.required_names()
    assert 'merchant_id' in spec.conditional_names()


def test_video_requires_youtube_and_logo():
    spec = GOOGLE_WORKFLOW_SPECS['google_video_create']
    names = {p.name for p in spec.parameters}
    assert 'youtube_video_id' in names
    assert 'logo_image' in names


def test_all_meta_objectives_have_specs():
    for objective in (
        'OUTCOME_TRAFFIC',
        'OUTCOME_AWARENESS',
        'OUTCOME_ENGAGEMENT',
        'OUTCOME_LEADS',
        'OUTCOME_SALES',
        'OUTCOME_APP_PROMOTION',
    ):
        wf_id = meta_workflow_id_for_objective(objective)
        assert wf_id in META_WORKFLOW_SPECS
        assert META_WORKFLOW_SPECS[wf_id].meta_objective == objective


def test_meta_leads_has_conditional_form_and_url():
    spec = META_WORKFLOW_SPECS['meta_leads_create']
    cond = spec.conditional_names()
    assert 'lead_form_id' in cond
    assert 'link_url' in cond


def test_workflow_registry_includes_social_and_landing():
    assert 'social_post_create' in WORKFLOW_REGISTRY
    assert 'landing_page_create' in WORKFLOW_REGISTRY
    assert len(WORKFLOW_REGISTRY) >= 15


def test_dialogue_falls_back_without_planner():
    from lib.planner.agent_dialogue import render_agent_message

    text = render_agent_message(
        workspace_id=None,
        phase='collect',
        workflow_label='Test',
        facts={'budget': 8},
        missing=['End date'],
    )
    assert 'End date' in text
