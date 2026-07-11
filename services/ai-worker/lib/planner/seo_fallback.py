"""Deterministic SEO / competitive intel workflows when planner LLM returns no steps."""

from __future__ import annotations

import re
from typing import Any


def is_actionable_seo_request(message: str) -> bool:
    m = (message or '').lower().strip()
    if len(m) < 6:
        return False
    if any(k in m for k in (
        'seo',
        'keyword cluster',
        'cluster keywords',
        'rank check',
        'rank tracking',
        'serp rank',
        'search rank',
        'landing page audit',
        'audit landing',
        'competitive analysis',
        'competitor analysis',
        'competitor intel',
        'ads library',
        'content calendar',
        'calendar suggestions',
        'post ideas',
    )):
        return True
    if 'keyword' in m and any(k in m for k in ('cluster', 'group', 'intent', 'track', 'rank')):
        return True
    if 'competitor' in m and any(k in m for k in ('analyze', 'analysis', 'research', 'scrape')):
        return True
    return False


def _extract_seed_keywords(message: str) -> list[str]:
    quoted = re.findall(r'"([^"]+)"|\'([^\']+)\'', message or '')
    seeds = [a or b for a, b in quoted if (a or b)]
    if seeds:
        return seeds[:20]
    m = re.search(r'keywords?[:\s]+(.+?)(?:\.|$)', message or '', re.I)
    if m:
        parts = re.split(r'[,;]\s*', m.group(1))
        return [p.strip() for p in parts if p.strip()][:20]
    return []


def _extract_competitor_name(message: str) -> str:
    for pattern in (
        r'competitor(?: analysis| intel)? (?:for|on|about)\s+(.+?)(?:\.|$)',
        r'analyze (?:competitor )?(.+?)(?:\.|$)',
    ):
        m = re.search(pattern, message or '', re.I)
        if m:
            return m.group(1).strip().strip('"\'')[:120]
    return ''


def build_fallback_seo_workflow(message: str, ctx: dict[str, Any]) -> dict[str, Any]:
    m = (message or '').lower()
    ws = ctx.get('workspace_id')

    if any(k in m for k in ('competitive', 'competitor')):
        name = _extract_competitor_name(message) or 'competitor'
        return {
            'intent': 'seo_marketing',
            'summary': f'Competitive analysis: {name}',
            'requires_approval': False,
            'assistant_message': f'Running competitive analysis for {name}.',
            'steps': [{
                'step_id': 'step_seo_comp_1',
                'tool_id': 'analyze_competitive_landscape',
                'label': 'Competitive analysis',
                'payload': {
                    'workspace_id': ws,
                    'competitor_name': name,
                },
            }],
        }

    if 'audit' in m and 'landing' in m:
        return {
            'intent': 'seo_marketing',
            'summary': 'Audit landing pages for SEO',
            'requires_approval': False,
            'assistant_message': 'Auditing your workspace landing pages for on-page SEO issues.',
            'steps': [{
                'step_id': 'step_seo_audit_1',
                'tool_id': 'audit_seo_landing_pages',
                'label': 'Landing page SEO audit',
                'payload': {'workspace_id': ws},
            }],
        }

    if any(k in m for k in ('rank', 'serp', 'tracking')):
        return {
            'intent': 'seo_marketing',
            'summary': 'Check keyword ranks',
            'requires_approval': False,
            'assistant_message': 'Checking SERP ranks for your tracked keyword targets.',
            'steps': [{
                'step_id': 'step_seo_rank_1',
                'tool_id': 'check_seo_keyword_ranks',
                'label': 'Keyword rank check',
                'payload': {'workspace_id': ws},
            }],
        }

    seeds = _extract_seed_keywords(message)
    if not seeds:
        return {
            'intent': 'seo_marketing',
            'summary': 'Cluster SEO keywords by intent',
            'chat_only': True,
            'requires_approval': False,
            'assistant_message': 'Please provide seed keywords (comma-separated or quoted) to cluster by search intent.',
            'steps': [],
        }
    return {
        'intent': 'seo_marketing',
        'summary': 'Cluster SEO keywords by intent',
        'requires_approval': False,
        'assistant_message': 'Clustering your seed keywords by search intent.',
        'steps': [{
            'step_id': 'step_seo_cluster_1',
            'tool_id': 'cluster_seo_keywords',
            'label': 'Keyword clustering',
            'payload': {
                'workspace_id': ws,
                'seed_keywords': seeds,
            },
        }],
    }
