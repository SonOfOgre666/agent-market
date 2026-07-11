"""LLM-first Google campaign naming."""

from __future__ import annotations

from lib.planner.google_campaign_llm import (
    GoogleCampaignFieldExtraction,
    emergency_campaign_name,
    explicit_campaign_name_from_prompt,
    resolve_google_campaign_name,
)


def test_explicit_name_honored():
    name = resolve_google_campaign_name(
        prompt='Create a search campaign called "Summer Protein Push"',
        llm_fields=GoogleCampaignFieldExtraction(campaign_name='Ignored LLM name'),
    )
    assert name == 'Summer Protein Push'


def test_llm_proposed_name_used():
    fields = GoogleCampaignFieldExtraction(
        campaign_name='ProDiet Nutrition — Morocco & France Search',
    )
    name = resolve_google_campaign_name(
        prompt='Search campaign Morocco France https://www.prodietnutrition.ma/fr/',
        llm_fields=fields,
    )
    assert 'ProDiet' in name
    assert name != 'New campaign'


def test_emergency_name_from_url():
    name = emergency_campaign_name(
        prompt='Search https://www.prodietnutrition.ma/fr/ Morocco',
        campaign_type='search',
        geo_label='Morocco, France',
    )
    assert 'Prodietnutrition' in name or 'prodietnutrition' in name.lower()
    assert 'New campaign' not in name


def test_explicit_parser():
    assert explicit_campaign_name_from_prompt('named My Brand Launch') == 'My Brand Launch'
