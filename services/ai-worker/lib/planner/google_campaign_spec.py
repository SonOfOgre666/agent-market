"""
Google Ads campaign creation — Meta parity (collection → review → APPROVE → typed publish).

Supports all full-publish channel types: Search, Display, Video, Shopping, PMax, App, Local.
"""

from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

from lib.google_geo_targets import GOOGLE_GEO_BY_ISO, geo_target_ids_for_iso_codes
from lib.planner.geo_targeting_intent import (
    GeoTargetingIntent,
    extract_geo_targeting_intent,
    merge_geo_intent_with_llm_countries,
)
from lib.planner.meta_campaign_spec import (
    estimate_max_spend,
    extract_daily_budget,
    extract_destination_url,
    extract_end_time_iso,
    extract_start_time_iso,
    full_conversation_text,
    primary_image_attachment,
    resolve_geo_countries,
)
from lib.planner.agent_dialogue import (
    compiled_google_facts,
    enrich_facts_for_dialogue,
    render_agent_message,
)
from lib.planner.workflow_collect import compute_google_missing
from lib.planner.google_campaign_llm import (
    extract_google_campaign_fields_with_llm,
    generate_rsa_copy_with_llm,
    resolve_google_ad_copy,
    infer_business_context_from_prompt,
    resolve_google_campaign_name,
    resolve_search_promotion_context,
)
from lib.planner.google_keyword_pipeline import (
    apply_keyword_edits,
    extract_keywords_from_review_history,
    is_keyword_edit_message,
    run_search_keyword_pipeline,
)

GoogleCampaignType = Literal[
    'search',
    'display',
    'video',
    'shopping',
    'performance_max',
    'app',
    'local',
]

_BRANCHES_PATH = Path(__file__).resolve().parents[2] / 'schemas' / 'ads' / 'google_branches.json'

_APPROVE_RE = re.compile(r'\b(APPROVE|yes, create it|create campaign)\b', re.I)
_REVIEW_MARKERS = ('Google Campaign Review', 'Type APPROVE to continue', 'Approve this Google campaign')

_GEO_BY_ISO = GOOGLE_GEO_BY_ISO

_TYPE_MARKERS: list[tuple[GoogleCampaignType, tuple[str, ...]]] = [
    ('performance_max', ('performance max', 'pmax', 'p max', 'performance_max')),
    ('shopping', ('shopping campaign', 'shopping ads', 'product listing', 'merchant center')),
    ('video', ('video campaign', 'youtube ads', 'video ads', 'youtube campaign')),
    ('display', ('display campaign', 'display ads', 'banner ads', 'responsive display')),
    ('app', ('app campaign', 'app install', 'mobile app ads', 'app promotion')),
    ('local', ('local campaign', 'store visits', 'local ads')),
    ('search', ('search campaign', 'search ads', 'rsa', 'google search')),
]

_PUBLISH_TOOL_BY_TYPE: dict[str, str] = {
    'search': 'google_publish_search_campaign',
    'display': 'google_publish_display_campaign',
    'video': 'google_publish_video_campaign',
    'shopping': 'google_publish_shopping_campaign',
    'performance_max': 'google_publish_performance_max_campaign',
    'app': 'google_publish_app_campaign',
    'local': 'google_publish_local_campaign',
}

_KEYWORDS_BLOCK_RE = re.compile(
    r'(?:keywords?|key\s*words?)\s*[:=\-]\s*(.+?)(?:\n\n|\Z)',
    re.I | re.S,
)
_YT_ID_RE = re.compile(
    r'(?:youtube\.com/watch\?(?:[^&\s]+&)*v=|youtu\.be/|youtube\.com/shorts/)([\w-]{11})',
    re.I,
)
_MERCHANT_RE = re.compile(r'\bmerchant[_\s-]?id\s*[:=]\s*(\d+)\b', re.I)
_APP_ID_RE = re.compile(
    r'(?:app[_\s-]?id|application[_\s-]?id|package)\s*[:=]\s*([\w.]+)\b',
    re.I,
)
_BULLET_LINE_RE = re.compile(r'^\s*(?:[-*•]|\d+[.)])\s*(.+)$', re.M)
_TARGETING_QUOTED_RE = re.compile(
    r'\btargeting\s+"([^"]{2,60})"',
    re.I,
)
_GEO_LOCATION_RE = re.compile(
    r'\b(?:in|for|targeting|target)\s+'
    r'([A-Za-z][A-Za-z0-9\s,\-\']{2,48}?)(?=\s+with|\s+\$|\s+until|\s+\d|\s+keywords?|\s+https?://|$)',
    re.I,
)
_STATUS_ENABLED_RE = re.compile(
    r'\b(create\s+enabled|status\s*[:=]\s*enabled|run\s+enabled|start\s+enabled|campaign\s+enabled)\b',
    re.I,
)


@dataclass
class GoogleCampaignCompiled:
    name: str
    campaign_type: str
    budget_amount: float
    geo_target_constant_ids: list[int]
    geo_countries: list[str]
    final_url: str | None = None
    keywords: list[str] | None = None
    headlines: list[str] | None = None
    descriptions: list[str] | None = None
    merchant_id: str | None = None
    feed_label: str | None = None
    app_id: str | None = None
    youtube_video_id: str | None = None
    business_name: str | None = None
    media_id: str | None = None
    logo_media_id: str | None = None
    marketing_media_id: str | None = None
    square_media_id: str | None = None
    language_ids: list[int] | None = None
    end_date: str | None = None
    start_date: str | None = None
    geo_query: str | None = None
    geo_intent: GeoTargetingIntent | None = None
    needs_geo_search: bool = False
    needs_geo_resolve: bool = False
    auto_merchant: bool = False
    keyword_match_type: str = 'BROAD'
    negative_keywords: list[str] | None = None
    estimated_max_spend: float = 0.0
    day_count: int = 0
    status: str = 'PAUSED'
    currency: str = 'USD'
    type_inferred: bool = False
    keywords_generated: bool = False
    copy_generated: bool = False
    business_context: str | None = None
    keyword_seeds: list[str] | None = None
    suggested_keywords: list[str] | None = None
    keyword_source: str | None = None
    copy_source: str | None = None


def _load_branches() -> dict[str, Any]:
    try:
        return json.loads(_BRANCHES_PATH.read_text(encoding='utf-8'))
    except OSError:
        return {'branches': {}}


_TYPE_LINE_ALIASES: dict[str, GoogleCampaignType] = {
    'search': 'search',
    'display': 'display',
    'video': 'video',
    'shopping': 'shopping',
    'app': 'app',
    'local': 'local',
    'performance max': 'performance_max',
    'performance_max': 'performance_max',
    'pmax': 'performance_max',
    'p max': 'performance_max',
}


_TYPE_TYPO_ALIASES: dict[str, GoogleCampaignType] = {
    'searh': 'search',
    'serach': 'search',
    'serch': 'search',
    'serach campaign': 'search',
    'searh campaign': 'search',
    'dispaly': 'display',
    'shoping': 'shopping',
    'perfromance max': 'performance_max',
    'perfomance max': 'performance_max',
}


def _normalize_campaign_type_token(raw: str) -> str:
    key = re.sub(r'\s+', ' ', (raw or '').strip().lower())
    key = re.sub(r'\s+campaign\s*$', '', key).strip()
    return _TYPE_TYPO_ALIASES.get(key, key)


def _campaign_type_from_collection_lines(prompt: str) -> GoogleCampaignType | None:
    """Match standalone replies like ``Search`` on their own line during collection."""
    for line in (prompt or '').splitlines():
        key = _normalize_campaign_type_token(line)
        if key in _TYPE_LINE_ALIASES:
            return _TYPE_LINE_ALIASES[key]
    return None


def google_campaign_type_from_prompt(prompt: str) -> GoogleCampaignType | None:
    line_type = _campaign_type_from_collection_lines(prompt)
    if line_type:
        return line_type

    m = (prompt or '').lower()
    for ctype, markers in _TYPE_MARKERS:
        if any(marker in m for marker in markers):
            return ctype

    if re.search(r'\b(?:pmax|p max|performance max)\b', m):
        return 'performance_max'
    for ctype in ('shopping', 'search', 'display', 'video', 'local'):
        token = ctype.replace('_', ' ')
        if re.search(rf'\b{re.escape(token)}\b', m):
            return ctype  # type: ignore[return-value]
    if re.search(r'\bapp\b', m) and not re.search(r'\bapplication\b', m):
        return 'app'
    return None


def resolve_google_campaign_type(
    prompt: str,
    *,
    explicit: str | None = None,
) -> tuple[GoogleCampaignType | None, bool]:
    """Return (type, inferred). None when unclear."""
    if explicit:
        norm = explicit.strip().lower().replace('-', '_')
        if norm in _PUBLISH_TOOL_BY_TYPE:
            return norm, False  # type: ignore[return-value]
    detected = google_campaign_type_from_prompt(prompt)
    if detected:
        return detected, True
    return None, False


def resolve_geo_target_ids(
    prompt: str,
    base_payload: dict[str, Any] | None = None,
) -> list[int] | None:
    ids, _query, _countries = resolve_google_geo(prompt, base_payload)
    return ids


def resolve_google_geo(
    prompt: str,
    base_payload: dict[str, Any] | None = None,
) -> tuple[list[int] | None, str | None, list[str]]:
    """
    Resolve geo to constant IDs when possible (country aliases).
    Returns (ids, geo_search_query, country_codes).
    """
    countries = resolve_geo_countries(prompt, base_payload) or []
    ids, missing = geo_target_ids_for_iso_codes(countries)
    if ids:
        return ids, None, countries
    if missing:
        return None, None, countries

    loc = _GEO_LOCATION_RE.search(prompt or '')
    if loc:
        phrase = loc.group(1).strip().rstrip(',')
        if phrase and phrase.lower() not in ('my', 'a', 'the', 'google', 'search', 'display'):
            return None, phrase, countries

    return None, None, countries


def google_date_only(iso_value: str | None) -> str | None:
    if not iso_value:
        return None
    return str(iso_value)[:10]


def resolve_campaign_status(prompt: str) -> str:
    """Optional — defaults to PAUSED unless user explicitly requests enabled."""
    if _STATUS_ENABLED_RE.search(prompt or ''):
        return 'ENABLED'
    return 'PAUSED'


def extract_keyword_match_type(prompt: str) -> str:
    m = (prompt or '').lower()
    if 'phrase match' in m or 'phrase-match' in m:
        return 'PHRASE'
    if 'exact match' in m or 'exact-match' in m:
        return 'EXACT'
    return 'BROAD'


def extract_negative_keywords(prompt: str) -> list[str] | None:
    block = re.search(
        r'negative\s+keywords?\s*[:=\-]\s*(.+?)(?:\n\n|\Z)',
        prompt or '',
        re.I | re.S,
    )
    if not block:
        return None
    parts = re.split(r'[,;\n]+', block.group(1).strip())
    out = [p.strip() for p in parts if p.strip()]
    return out or None


def extract_keywords(prompt: str) -> list[str] | None:
    targeting_quoted = _TARGETING_QUOTED_RE.search(prompt or '')
    if targeting_quoted:
        kw = targeting_quoted.group(1).strip()
        if kw and not kw.startswith('http'):
            return [kw]

    block = _KEYWORDS_BLOCK_RE.search(prompt or '')
    if block:
        raw = block.group(1).strip()
        parts = re.split(r'[,;\n]+', raw)
        out = [p.strip() for p in parts if p.strip()]
        return out or None
    bullets = _BULLET_LINE_RE.findall(prompt or '')
    kw_like = [b.strip() for b in bullets if len(b.split()) <= 6 and not b.startswith('http')]
    if len(kw_like) >= 1:
        return kw_like
    quoted = re.findall(r'"([^"]{2,60})"|\'([^\']{2,60})\'', prompt or '')
    flat = [a or b for a, b in quoted if (a or b)]
    if len(flat) >= 1:
        return flat
    return None


def extract_youtube_video_id(prompt: str) -> str | None:
    m = _YT_ID_RE.search(prompt or '')
    return m.group(1) if m else None


def extract_merchant_id(prompt: str) -> str | None:
    m = _MERCHANT_RE.search(prompt or '')
    return m.group(1) if m else None


def extract_app_id(prompt: str) -> str | None:
    m = _APP_ID_RE.search(prompt or '')
    return m.group(1) if m else None


def infer_business_context(prompt: str) -> str | None:
    """Alias for explicit-prompt extraction (used in tests and compile)."""
    return infer_business_context_from_prompt(prompt)


def is_business_inferable(
    prompt: str,
    campaign_type: str | None,
    *,
    conversation_history: list[dict[str, Any]] | None = None,
    final_url: str | None = None,
    workspace_id: str | None = None,
) -> bool:
    """True when Search keywords/copy can be auto-generated without asking what they promote."""
    if campaign_type != 'search':
        return True
    inferable, _ctx = resolve_search_promotion_context(
        prompt=prompt,
        conversation_history=conversation_history,
        final_url=final_url,
        workspace_id=workspace_id,
    )
    return inferable


def _text_lines_from_prompt(prompt: str, *, field: str) -> list[str] | None:
    pattern = re.compile(
        rf'{field}s?\s*[:=\-]\s*(.+?)(?:\n\n|\Z)',
        re.I | re.S,
    )
    m = pattern.search(prompt or '')
    if not m:
        return None
    raw = m.group(1).strip()
    parts = re.split(r'[,;\n]+', raw)
    out = [p.strip() for p in parts if p.strip()]
    return out or None


def collect_missing_lines(
    *,
    campaign_type: GoogleCampaignType | None,
    budget: float | None,
    end_date: str | None,
    geo_ids: list[int] | None,
    geo_query: str | None,
    final_url: str | None,
    keywords: list[str] | None,
    merchant_id: str | None,
    auto_merchant: bool,
    app_id: str | None,
    youtube_video_id: str | None,
    has_image: bool,
    type_ambiguous: bool,
    business_inferable: bool = True,
    geo_countries: list[str] | None = None,
    geo_intent: GeoTargetingIntent | None = None,
) -> list[str]:
    """Missing required/conditional params — driven by workflow_spec (edit spec to change rules)."""
    missing_params = compute_google_missing(
        campaign_type=campaign_type,
        budget=budget,
        end_date=end_date,
        geo_ids=geo_ids,
        geo_query=geo_query,
        geo_countries=geo_countries,
        geo_intent=geo_intent,
        final_url=final_url,
        keywords=keywords,
        merchant_id=merchant_id,
        auto_merchant=auto_merchant,
        app_id=app_id,
        youtube_video_id=youtube_video_id,
        has_image=has_image,
        business_inferable=business_inferable,
        type_ambiguous=type_ambiguous,
    )
    return [m.as_line() for m in missing_params]


def build_google_setup_clarification_message(
    *,
    missing_lines: list[str],
    preamble: str | None = None,
    campaign_type: str | None = None,
    business_inferable: bool = False,
) -> str:
    lines = [
        'Google Campaign Setup',
        '',
    ]
    if preamble:
        lines.extend([preamble, ''])
    if missing_lines:
        lines.append('I can help with that. I still need:')
        for item in missing_lines:
            lines.append(f'• {item}')
        lines.append('')
    if campaign_type == 'search' and business_inferable:
        lines.append(
            'I can automatically generate relevant keywords and ad copy from your business '
            'description — reply with your own keywords or headlines only if you prefer.'
        )
        lines.append('')
    if missing_lines:
        lines.append('You can reply in one message with all missing details.')
    return '\n'.join(lines)


def is_google_review_message(content: str) -> bool:
    return any(m in (content or '') for m in _REVIEW_MARKERS)


def is_google_campaign_approval(
    message: str,
    conversation_history: list[dict[str, Any]] | None,
) -> bool:
    if not _APPROVE_RE.search(message or ''):
        return False
    for msg in reversed(conversation_history or []):
        if msg.get('role') == 'assistant':
            return is_google_review_message(str(msg.get('content') or ''))
    return False


def build_review_message(compiled: GoogleCampaignCompiled) -> str:
    branches = _load_branches().get('branches') or {}
    type_label = (branches.get(compiled.campaign_type) or {}).get('label') or compiled.campaign_type
    if compiled.geo_intent and compiled.geo_intent.display_label():
        geo_label = compiled.geo_intent.display_label() + ' (resolve at publish)'
    elif compiled.geo_countries:
        geo_label = ', '.join(compiled.geo_countries)
    elif compiled.geo_query:
        geo_label = f'{compiled.geo_query} (resolve at publish)'
    else:
        geo_label = ', '.join(str(x) for x in compiled.geo_target_constant_ids)
    lines = [
        'Google Campaign Review',
        '',
        f'Campaign type: {type_label}'
        + (' (inferred from your request)' if compiled.type_inferred else ''),
        f'Budget: ${compiled.budget_amount:.0f}/day',
    ]
    if compiled.end_date and compiled.estimated_max_spend:
        lines.append(
            f'Estimated maximum spend: ${compiled.estimated_max_spend:.0f} '
            f'(${compiled.budget_amount:.0f}/day × {compiled.day_count} days until {compiled.end_date})'
        )
    if compiled.end_date:
        lines.append(f'End date: {compiled.end_date}')
    if compiled.start_date:
        lines.append(f'Start date: {compiled.start_date}')
    lines.extend([
        f'Locations: {geo_label}',
        f'Status: {compiled.status}',
    ])
    if compiled.business_context:
        lines.append(f'Business: {compiled.business_context}')
    if compiled.final_url:
        lines.append(f'Website: {compiled.final_url}')
    if compiled.keywords:
        if compiled.keywords_generated:
            source = compiled.keyword_source or 'generated'
            lines.append(f'Generated keywords ({source}):')
            for kw in compiled.keywords[:8]:
                lines.append(f'  ✓ {kw}')
            if compiled.suggested_keywords:
                lines.append('Suggested keywords:')
                for kw in compiled.suggested_keywords[:6]:
                    lines.append(f'  ○ {kw}')
            lines.extend([
                '',
                'Edit keywords before approving:',
                '  • APPROVE',
                '  • REMOVE <keyword>',
                '  • ADD <keyword>',
            ])
        else:
            lines.append('Keywords:')
            for kw in compiled.keywords[:8]:
                lines.append(f'  • {kw}')
    if compiled.headlines:
        if compiled.copy_generated:
            label = f'Generated headlines ({compiled.copy_source or "ai"})'
        else:
            label = 'Headlines'
        lines.append(f'{label}: {" | ".join(compiled.headlines[:5])}')
    if compiled.descriptions:
        if compiled.copy_generated:
            label = f'Generated descriptions ({compiled.copy_source or "ai"})'
        else:
            label = 'Descriptions'
        lines.append(f'{label}: {" | ".join(compiled.descriptions[:3])}')
    if compiled.merchant_id:
        lines.append(f'Merchant ID: {compiled.merchant_id}')
    elif compiled.auto_merchant:
        lines.append('Merchant Center: auto (first linked account at publish)')
    if compiled.app_id:
        lines.append(f'App ID: {compiled.app_id}')
    if compiled.youtube_video_id:
        lines.append(f'YouTube video: {compiled.youtube_video_id}')
    if compiled.media_id:
        lines.append('Creative: image from your library attachment')

    publish_tool = _PUBLISH_TOOL_BY_TYPE.get(compiled.campaign_type, 'google_publish_campaign')
    lines.extend([
        '',
        f'Publish tool: {publish_tool}',
        '',
        'Approve this Google campaign?',
        'Type APPROVE to continue.',
    ])
    return '\n'.join(lines)


def build_publish_payload(
    base: dict[str, Any],
    compiled: GoogleCampaignCompiled,
    *,
    account_step: str | None = None,
    geo_step: str | None = None,
    merchant_step: str | None = None,
) -> dict[str, Any]:
    currency = compiled.currency
    schedule_tz: str | None = None
    publish_customer_ref: str | None = None
    if account_step:
        currency = f'${account_step}.output.currency'
        schedule_tz = f'${account_step}.output.timezone'
        publish_customer_ref = f'${account_step}.output.publish_customer_id'

    payload: dict[str, Any] = {
        **base,
        'name': compiled.name,
        'type': compiled.campaign_type,
        'campaign_type': compiled.campaign_type,
        'budget': {'amount': compiled.budget_amount, 'currency': currency},
        'status': compiled.status,
        'adgroup_status': 'PAUSED',
    }
    if publish_customer_ref:
        payload['customer_id'] = publish_customer_ref
    if compiled.geo_target_constant_ids and not geo_step:
        payload['geo_target_constant_ids'] = compiled.geo_target_constant_ids
    elif geo_step:
        if compiled.needs_geo_resolve:
            payload['geo_target_constant_ids'] = f'${geo_step}.output.include_ids'
        else:
            payload['geo_target_constant_ids'] = [f'${geo_step}.output.data[0].geo_target_constant_id']

    if compiled.end_date:
        payload['end_date'] = compiled.end_date
    if compiled.start_date:
        payload['start_date'] = compiled.start_date
    if schedule_tz:
        payload['schedule_timezone'] = schedule_tz

    creatives: dict[str, Any] = {}
    if compiled.final_url:
        creatives['final_url'] = compiled.final_url
        creatives['link_url'] = compiled.final_url
    if compiled.headlines:
        creatives['headlines'] = compiled.headlines
    if compiled.descriptions:
        creatives['descriptions'] = compiled.descriptions
    if compiled.business_name:
        creatives['business_name'] = compiled.business_name
    if compiled.youtube_video_id:
        creatives['youtube_video_id'] = compiled.youtube_video_id
    if creatives:
        payload['creatives'] = creatives

    if compiled.keywords:
        payload['keywords'] = compiled.keywords
        entries = [{'text': k, 'match_type': compiled.keyword_match_type} for k in compiled.keywords]
        payload['keyword_entries'] = entries
    if compiled.merchant_id:
        payload['merchant_id'] = compiled.merchant_id
    elif merchant_step:
        payload['merchant_id'] = f'${merchant_step}.output.merchant_centers[0].merchant_id'
    if compiled.feed_label:
        payload['feed_label'] = compiled.feed_label
    if compiled.app_id:
        payload['app_id'] = compiled.app_id
    if compiled.language_ids:
        payload['language_ids'] = compiled.language_ids

    if compiled.media_id:
        payload['media_id'] = compiled.media_id
    if compiled.logo_media_id:
        payload['logo_media_id'] = compiled.logo_media_id
    if compiled.marketing_media_id:
        payload['marketing_media_id'] = compiled.marketing_media_id
    if compiled.square_media_id:
        payload['square_media_id'] = compiled.square_media_id

    return payload


def build_google_execute_steps(
    base: dict[str, Any],
    compiled: GoogleCampaignCompiled,
) -> list[dict[str, Any]]:
    publish_tool = _PUBLISH_TOOL_BY_TYPE.get(
        compiled.campaign_type,
        'google_publish_campaign',
    )
    steps: list[dict[str, Any]] = []
    next_i = 1

    account_step = f'step_{next_i}'
    steps.append({
        'step_id': account_step,
        'tool_id': 'google_get_account',
        'payload': dict(base),
        'depends_on': [],
    })
    next_i += 1

    geo_step: str | None = None
    if compiled.needs_geo_resolve and compiled.geo_intent:
        geo_step = f'step_{next_i}'
        steps.append({
            'step_id': geo_step,
            'tool_id': 'google_resolve_geo_targeting',
            'payload': {**base, **compiled.geo_intent.to_payload()},
            'depends_on': [account_step],
        })
        next_i += 1
    elif compiled.needs_geo_search and compiled.geo_query:
        geo_step = f'step_{next_i}'
        steps.append({
            'step_id': geo_step,
            'tool_id': 'google_search_geo_locations',
            'payload': {**base, 'query': compiled.geo_query, 'limit': 5},
            'depends_on': [account_step],
        })
        next_i += 1

    merchant_step: str | None = None
    if compiled.auto_merchant:
        merchant_step = f'step_{next_i}'
        steps.append({
            'step_id': merchant_step,
            'tool_id': 'google_list_merchant_centers',
            'payload': dict(base),
            'depends_on': [account_step],
        })
        next_i += 1

    publish_step = f'step_{next_i}'
    publish_deps = [account_step]
    if geo_step:
        publish_deps.append(geo_step)
    if merchant_step:
        publish_deps.append(merchant_step)

    payload = build_publish_payload(
        base,
        compiled,
        account_step=account_step,
        geo_step=geo_step,
        merchant_step=merchant_step,
    )
    steps.append({
        'step_id': publish_step,
        'tool_id': publish_tool,
        'payload': payload,
        'depends_on': publish_deps,
        'requires_approval': True,
    })

    if compiled.negative_keywords:
        neg_step = f'step_{next_i + 1}'
        steps.append({
            'step_id': neg_step,
            'tool_id': 'google_add_negative_keywords',
            'payload': {
                **base,
                'platform_campaign_id': f'${publish_step}.output.platform_campaign_id',
                'keywords': compiled.negative_keywords,
            },
            'depends_on': [publish_step],
            'requires_approval': True,
        })

    if (
        geo_step
        and compiled.geo_intent
        and compiled.geo_intent.exclude
        and compiled.needs_geo_resolve
    ):
        exclude_step = f'step_{next_i + (2 if compiled.negative_keywords else 1)}'
        steps.append({
            'step_id': exclude_step,
            'tool_id': 'google_exclude_geo_targets',
            'payload': {
                **base,
                'platform_campaign_id': f'${publish_step}.output.platform_campaign_id',
                'geo_target_constant_ids': f'${geo_step}.output.exclude_ids',
            },
            'depends_on': [publish_step],
            'requires_approval': True,
        })

    return steps


def _google_discovery_steps(base: dict[str, Any], *, campaign_type: str | None) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = [
        {
            'step_id': 'step_1',
            'tool_id': 'google_get_account',
            'payload': dict(base),
            'depends_on': [],
        },
    ]
    if campaign_type == 'shopping':
        steps.append({
            'step_id': 'step_2',
            'tool_id': 'google_list_merchant_centers',
            'payload': dict(base),
            'depends_on': ['step_1'],
        })
    return steps


def compile_google_campaign(
    *,
    name: str,
    prompt: str,
    ctx: dict[str, Any],
    base_payload: dict[str, Any],
) -> tuple[GoogleCampaignCompiled | None, list[str], bool, str, dict[str, Any]]:
    """Returns (compiled, missing_lines, needs_discovery, understood_summary, collected)."""
    history = ctx.get('conversation_history') or []
    full_text = full_conversation_text(prompt, history)
    workspace_id = str(base_payload.get('workspace_id') or ctx.get('workspace_id') or '') or None

    trace = ctx.get('planner_trace')
    if trace is not None:
        trace.log_llm('Extract campaign parameters', feature='Planner', source='google_campaign_collection')
    llm_fields = extract_google_campaign_fields_with_llm(
        prompt=full_text,
        conversation_history=None,
        workspace_id=workspace_id,
    )
    llm_understood = (llm_fields.understood_summary or '') if llm_fields else ''

    # LLM-first understanding; regex/helpers only when the model returns nothing for a field.
    if llm_fields and llm_fields.campaign_type:
        campaign_type: GoogleCampaignType | None = llm_fields.campaign_type  # type: ignore[assignment]
        type_inferred = True
    else:
        campaign_type, type_inferred = resolve_google_campaign_type(full_text)
    budget = (
        llm_fields.daily_budget
        if llm_fields and llm_fields.daily_budget is not None
        else extract_daily_budget(full_text)
    )
    llm_geo_fields: dict[str, Any] | None = None
    if llm_fields:
        if llm_fields.geo_targeting:
            llm_geo_fields = {'geo_targeting': llm_fields.geo_targeting}
        elif llm_fields.geo_countries:
            llm_geo_fields = {'geo_countries': llm_fields.geo_countries}
    geo_intent = extract_geo_targeting_intent(
        prompt=full_text,
        conversation_history=None,
        workspace_id=workspace_id,
        llm_geo_fields=llm_geo_fields,
    )
    if llm_fields and llm_fields.geo_countries:
        geo_intent = merge_geo_intent_with_llm_countries(geo_intent, llm_fields.geo_countries)

    geo_countries = geo_intent.country_codes() if geo_intent else []
    geo_ids: list[int] | None = None
    geo_query = geo_intent.display_label() if geo_intent else None
    needs_geo_resolve = bool(geo_intent and geo_intent.has_locations())
    needs_geo_search = False
    end_time_iso = (
        llm_fields.end_time
        if llm_fields and llm_fields.end_time
        else extract_end_time_iso(full_text)
    )
    start_time_iso = (
        llm_fields.start_time
        if llm_fields and llm_fields.start_time
        else extract_start_time_iso(full_text)
    )
    end_date = google_date_only(end_time_iso)
    start_date = google_date_only(start_time_iso)
    status = resolve_campaign_status(full_text)
    keyword_match_type = extract_keyword_match_type(full_text)
    negative_keywords = extract_negative_keywords(full_text)
    final_url = (
        llm_fields.final_url
        if llm_fields and llm_fields.final_url
        else extract_destination_url(full_text)
    )
    keywords = extract_keywords(full_text)
    headlines = _text_lines_from_prompt(full_text, field='headline')
    descriptions = _text_lines_from_prompt(full_text, field='description')
    keywords_generated = False
    keyword_seeds: list[str] | None = None
    suggested_keywords: list[str] | None = None
    keyword_source: str | None = None
    copy_generated = False
    copy_source: str | None = None

    # Business context: LLM when available, regex only as fallback.
    if llm_fields and llm_fields.business_context:
        business_context = llm_fields.business_context
        business_inferable = bool(campaign_type != 'search' or business_context)
    elif campaign_type == 'search':
        business_context = infer_business_context_from_prompt(full_text)
        business_inferable = is_business_inferable(full_text, 'search')
    else:
        business_context = infer_business_context_from_prompt(full_text)
        business_inferable = True

    name = resolve_google_campaign_name(
        prompt=full_text,
        llm_fields=llm_fields,
        campaign_type=campaign_type,
        geo_label=geo_intent.display_label() if geo_intent else None,
        final_url=final_url,
        business_context=business_context,
    )

    merchant_id = extract_merchant_id(full_text)
    app_id = extract_app_id(full_text)
    youtube_video_id = extract_youtube_video_id(full_text)
    attachment = primary_image_attachment(ctx)
    has_image = bool(attachment)
    auto_merchant = bool(campaign_type == 'shopping' and not merchant_id)

    collected: dict[str, Any] = {
        'campaign_type': campaign_type,
        'budget': budget,
        'geo': geo_countries,
        'geo_intent': geo_intent.to_payload() if geo_intent else None,
        'geo_ids': geo_ids,
        'geo_query': geo_query,
        'end_date': end_date,
        'final_url': final_url,
        'keywords': keywords,
        'merchant_id': merchant_id,
        'auto_merchant': auto_merchant,
        'app_id': app_id,
        'youtube_video_id': youtube_video_id,
        'status': status,
        'business_inferable': business_inferable,
        'business_context': business_context,
    }

    needs_discovery = bool(base_payload.get('account_id')) is False
    type_ambiguous = campaign_type is None

    missing = collect_missing_lines(
        campaign_type=campaign_type,
        budget=budget,
        end_date=end_date,
        geo_ids=geo_ids,
        geo_query=geo_query,
        final_url=final_url,
        keywords=keywords,
        merchant_id=merchant_id,
        auto_merchant=auto_merchant,
        app_id=app_id,
        youtube_video_id=youtube_video_id,
        has_image=has_image,
        type_ambiguous=type_ambiguous,
        business_inferable=business_inferable,
        geo_countries=geo_countries,
        geo_intent=geo_intent,
    )

    understood_parts: list[str] = []
    if campaign_type:
        branches = _load_branches().get('branches') or {}
        label = (branches.get(campaign_type) or {}).get('label') or campaign_type
        understood_parts.append(f'Campaign type: **{label}**')
    if budget is not None:
        understood_parts.append(f'Daily budget: **${budget:.0f}/day**')
    if geo_intent and geo_intent.display_label():
        understood_parts.append(f'Locations: **{geo_intent.display_label()}**')
    elif geo_countries:
        understood_parts.append(f'Locations: **{", ".join(geo_countries)}**')
    elif geo_query:
        understood_parts.append(f'Location: **{geo_query}**')
    if end_date:
        understood_parts.append(f'End date: **{end_date}**')
    if final_url:
        understood_parts.append(f'Landing page: `{final_url}`')
    if llm_understood and not (geo_intent and geo_intent.has_locations()):
        understood_summary = llm_understood
    elif llm_understood and geo_intent and geo_intent.has_locations():
        understood_summary = (
            'Got it — ' + '; '.join(understood_parts) + '.'
            if understood_parts
            else llm_understood
        )
    else:
        understood_summary = 'Got it — ' + '; '.join(understood_parts) + '.' if understood_parts else ''

    if missing:
        return None, missing, needs_discovery, understood_summary, collected

    # ── Marketing assets (keywords, RSA) only when all required params are present ──
    if campaign_type == 'search':
        trace = ctx.get('planner_trace')
        if trace is not None:
            trace.log_llm('Assess promotion context', feature='Google Search', source='google_promotion_context')
        business_inferable, business_context = resolve_search_promotion_context(
            prompt=full_text,
            conversation_history=history,
            final_url=final_url,
            workspace_id=workspace_id,
        )
        collected['business_inferable'] = business_inferable
        collected['business_context'] = business_context

    trace = ctx.get('planner_trace')

    if campaign_type == 'search' and not keywords and business_inferable:
        if is_keyword_edit_message(prompt):
            prior = extract_keywords_from_review_history(history)
            if prior:
                keywords = apply_keyword_edits(prior, prompt)
                keywords_generated = True
        if not keywords:
            if trace is not None:
                trace.log_llm('Generate keyword seeds', feature='Google Search', source='google_keyword_seeds')
                trace.log_tool('google_generate_keyword_ideas', label='Expand keywords (Keyword Planner)')
            pipeline = run_search_keyword_pipeline(
                prompt=full_text,
                conversation_history=history,
                business_context=business_context,
                geo_countries=geo_countries,
                geo_target_constant_ids=geo_ids,
                final_url=final_url,
                base_payload=base_payload,
                workspace_id=workspace_id,
            )
            keywords = pipeline.keywords
            suggested_keywords = pipeline.suggested_keywords or None
            keyword_seeds = pipeline.keyword_seeds or None
            keyword_source = pipeline.source
            keywords_generated = True

    if campaign_type == 'search' and keywords and is_keyword_edit_message(prompt):
        keywords = apply_keyword_edits(keywords, prompt)

    if campaign_type in ('search', 'display', 'app', 'performance_max', 'local'):
        if not headlines or not descriptions:
            if trace is not None:
                trace.log_llm('Generate RSA ad copy', feature='Google Ads', source='google_rsa_copy')
            gen_h, gen_d, copy_source = resolve_google_ad_copy(
                campaign_name=name,
                prompt=full_text,
                conversation_history=history,
                business_context=business_context,
                final_url=final_url,
                campaign_type=str(campaign_type),
                geo_countries=geo_countries,
                workspace_id=workspace_id,
            )
            if not headlines:
                headlines = gen_h
            if not descriptions:
                descriptions = gen_d
            copy_generated = True

    assert campaign_type is not None
    assert budget is not None
    assert end_date is not None
    assert geo_intent is not None and geo_intent.has_locations()

    max_spend, day_count = estimate_max_spend(
        budget,
        end_time_iso or f'{end_date}T23:59:59+0000',
        start_time_iso,
    )

    media_id = str(attachment.get('id') or '') if attachment else None
    logo_media_id = media_id if campaign_type in ('video', 'performance_max', 'local') else None
    marketing_media_id = media_id if campaign_type in ('display', 'performance_max', 'local') else None
    square_media_id = media_id if campaign_type in ('display', 'performance_max', 'local') else None

    compiled = GoogleCampaignCompiled(
        name=name,
        campaign_type=campaign_type,
        budget_amount=budget,
        geo_target_constant_ids=geo_ids or [],
        geo_countries=geo_countries,
        geo_intent=geo_intent,
        final_url=final_url,
        keywords=keywords,
        headlines=headlines,
        descriptions=descriptions,
        merchant_id=merchant_id,
        app_id=app_id,
        youtube_video_id=youtube_video_id,
        business_name=(business_context or name)[:25] if (business_context or name) else None,
        media_id=media_id,
        logo_media_id=logo_media_id,
        marketing_media_id=marketing_media_id,
        square_media_id=square_media_id,
        end_date=end_date,
        start_date=start_date,
        geo_query=geo_query,
        needs_geo_search=needs_geo_search,
        needs_geo_resolve=needs_geo_resolve,
        auto_merchant=auto_merchant,
        keyword_match_type=keyword_match_type,
        negative_keywords=negative_keywords,
        estimated_max_spend=max_spend,
        day_count=day_count,
        status=status,
        type_inferred=type_inferred,
        keywords_generated=keywords_generated,
        copy_generated=copy_generated,
        business_context=business_context,
        keyword_seeds=keyword_seeds,
        suggested_keywords=suggested_keywords,
        keyword_source=keyword_source,
        copy_source=copy_source,
    )
    return compiled, [], needs_discovery, understood_summary, collected


def preview_google_execute_tool_ids(campaign_type: str | None) -> list[str]:
    """Tool chain preview shown during collection (before APPROVE)."""
    ct = campaign_type or 'search'
    publish = _PUBLISH_TOOL_BY_TYPE.get(ct, 'google_publish_search_campaign')
    ids = ['google_get_account']
    if ct == 'shopping':
        ids.append('google_list_merchant_centers')
    ids.append('google_resolve_geo_targeting')
    ids.append(publish)
    return ids


def plan_google_create_workflow(
    *,
    prompt: str,
    ctx: dict[str, Any],
    base_payload: dict[str, Any],
    name: str,
) -> dict[str, Any]:
    """Entry point for Google campaign create (Meta parity)."""
    from lib.planner.ads_session import is_ads_collection_active
    from lib.planner.planner_trace import PlannerTrace

    if not ctx.get('planner_trace'):
        ctx['planner_trace'] = PlannerTrace()

    compiled, missing, needs_discovery, understood_summary, collected = compile_google_campaign(
        name=name,
        prompt=prompt,
        ctx=ctx,
        base_payload=base_payload,
    )
    history = ctx.get('conversation_history') or []
    campaign_type = collected.get('campaign_type')

    if needs_discovery:
        wid = base_payload.get('workspace_id') or ctx.get('workspace_id')
        discovery_msg = render_agent_message(
            workspace_id=str(wid) if wid else None,
            phase='acknowledge',
            workflow_label='Google Ads campaign',
            facts={'phase': 'account_discovery'},
            extra_instructions='Explain we are loading the Google Ads account, then will collect campaign details.',
        )
        graph = {
            'google_setup_phase': 'discovery',
            'intent': 'ads_campaign',
            'summary': 'Discover Google Ads account for campaign setup.',
            'assistant_message': discovery_msg,
            'steps': _google_discovery_steps(base_payload, campaign_type=campaign_type),
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
            'requires_approval': False,
        }
        trace = ctx.get('planner_trace')
        if trace is not None:
            for step in graph['steps']:
                trace.log_tool(str(step.get('tool_id') or ''))
            trace.attach(graph)
        return graph

    if missing:
        wid = base_payload.get('workspace_id') or ctx.get('workspace_id')
        spec_label = f'Google {campaign_type or "Ads"} campaign'
        missing_params = compute_google_missing(
            campaign_type=campaign_type,
            budget=collected.get('budget'),
            end_date=collected.get('end_date'),
            geo_ids=collected.get('geo_ids'),
            geo_query=collected.get('geo_query'),
            geo_countries=collected.get('geo'),
            final_url=collected.get('final_url'),
            keywords=collected.get('keywords'),
            merchant_id=collected.get('merchant_id'),
            auto_merchant=bool(collected.get('auto_merchant')),
            app_id=collected.get('app_id'),
            youtube_video_id=collected.get('youtube_video_id'),
            has_image=bool(primary_image_attachment(ctx)),
            business_inferable=bool(collected.get('business_inferable')),
            type_ambiguous=not campaign_type,
        )
        clarification = render_agent_message(
            workspace_id=str(wid) if wid else None,
            phase='collect',
            workflow_label=spec_label,
            facts=enrich_facts_for_dialogue(
                {k: v for k, v in collected.items() if v is not None}
            ),
            missing=missing_params,
            extra_instructions=(
                'Keywords and RSA ad copy can be auto-generated when business context is clear.'
                if campaign_type == 'search' and collected.get('business_inferable')
                else ''
            ),
            use_llm=True,
        )
        graph = {
            'intent': 'informational',
            'collection_phase': True,
            'summary': 'Collect Google campaign details before publish.',
            'assistant_message': clarification,
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
            'execute_plan': preview_google_execute_tool_ids(campaign_type),
        }
        trace = ctx.get('planner_trace')
        if trace is not None:
            trace.attach(graph)
        return graph

    assert compiled is not None

    if not is_google_campaign_approval(prompt, history):
        wid = base_payload.get('workspace_id') or ctx.get('workspace_id')
        review = render_agent_message(
            workspace_id=str(wid) if wid else None,
            phase='review',
            workflow_label=f'Google {compiled.campaign_type} campaign',
            facts=compiled_google_facts(compiled),
            extra_instructions=(
                'User can APPROVE, REMOVE <keyword>, or ADD <keyword> to edit generated keywords.'
                if compiled.keywords_generated
                else 'End with: Type APPROVE to continue.'
            ),
        )
        graph = {
            'intent': 'informational',
            'google_setup_phase': 'ready_for_review',
            'google_compiled': asdict(compiled),
            'google_account_id': base_payload.get('account_id'),
            'summary': f'Review Google {compiled.campaign_type} campaign "{name}" before publish.',
            'assistant_message': review,
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
            'requires_approval': True,
            'execute_plan': preview_google_execute_tool_ids(compiled.campaign_type),
        }
        trace = ctx.get('planner_trace')
        if trace is not None:
            trace.attach(graph)
        return graph

    steps = build_google_execute_steps(base_payload, compiled)
    gates = [s['step_id'] for s in steps if s.get('requires_approval')]
    geo_label = ', '.join(compiled.geo_countries) if compiled.geo_countries else 'target geo'
    publish_tool = _PUBLISH_TOOL_BY_TYPE.get(compiled.campaign_type, 'google_publish_campaign')
    wid = base_payload.get('workspace_id') or ctx.get('workspace_id')
    success_msg = render_agent_message(
        workspace_id=str(wid) if wid else None,
        phase='success',
        workflow_label=f'Google {compiled.campaign_type} campaign',
        facts=compiled_google_facts(compiled),
        success_detail=f'Executing {publish_tool} for "{name}" ({geo_label}, PAUSED on Google Ads).',
    )
    graph = {
        'intent': 'ads_campaign',
        'google_compiled': asdict(compiled),
        'google_account_id': base_payload.get('account_id'),
        'summary': (
            f'Create paused Google {compiled.campaign_type} campaign "{name}" ({geo_label}).'
        ),
        'assistant_message': success_msg,
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': gates,
        'requires_approval': True,
    }
    trace = ctx.get('planner_trace')
    if trace is not None:
        for step in steps:
            trace.log_tool(str(step.get('tool_id') or ''))
        trace.attach(graph)
    return graph


def compiled_from_graph(graph: dict[str, Any]) -> GoogleCampaignCompiled | None:
    raw = graph.get('google_compiled')
    if not isinstance(raw, dict):
        return None
    from lib.planner.geo_targeting_intent import restore_geo_intent

    fields = GoogleCampaignCompiled.__dataclass_fields__
    kwargs = {k: raw[k] for k in fields if k in raw}
    if 'geo_intent' in kwargs:
        kwargs['geo_intent'] = restore_geo_intent(kwargs['geo_intent'])
    return GoogleCampaignCompiled(**kwargs)


def materialize_google_compiled_graph(
    graph: dict[str, Any],
    *,
    account_id: str,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """Expand stored google_compiled into executable publish steps (UI Approve path)."""
    if graph.get('steps'):
        return graph
    compiled = compiled_from_graph(graph)
    if not compiled:
        return graph

    base = {'account_id': account_id, 'workspace_id': workspace_id}
    steps = build_google_execute_steps(base, compiled)
    gates = [s['step_id'] for s in steps if s.get('requires_approval')]
    publish_tool = _PUBLISH_TOOL_BY_TYPE.get(compiled.campaign_type, 'google_publish_campaign')
    return {
        **graph,
        'intent': 'ads_campaign',
        'google_setup_phase': 'approved',
        'summary': (
            graph.get('summary')
            or f'Create paused Google {compiled.campaign_type} campaign "{compiled.name}".'
        ),
        'assistant_message': (
            f'Approved — executing {publish_tool} '
            f'(${compiled.budget_amount:.0f}/day, PAUSED on Google Ads).'
        ),
        'steps': steps,
        'dependencies': graph.get('dependencies') or [],
        'parallel_groups': graph.get('parallel_groups') or [],
        'approval_gates': gates,
        'requires_approval': True,
    }
