"""Geo display for dialogue — MA must read as Morocco, not Massachusetts."""

from lib.planner.agent_dialogue import enrich_facts_for_dialogue, format_geo_display


def test_format_geo_morocco_not_massachusetts():
    assert format_geo_display(['MA']) == 'Morocco (MA)'


def test_enrich_facts_replaces_bare_geo():
    facts = enrich_facts_for_dialogue({'geo': ['MA'], 'budget': 8})
    assert facts['locations'] == 'Morocco (MA)'
    assert 'geo' not in facts
