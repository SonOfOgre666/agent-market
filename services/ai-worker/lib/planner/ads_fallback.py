"""Deterministic ads workflows when the planner returns no steps for actionable ads requests."""

from __future__ import annotations

import re
from typing import Any, Literal

from lib.planner.ads_session import (
    is_ads_collection_active,
    is_assistant_collecting_ads_fields,
    is_short_ads_followup_reply,
    merge_ads_conversation_user_messages,
    resolve_ads_session,
)
from lib.planner.meta_page_selection import (
    is_meta_acceptable_destination_url,
    pages_from_assistant_message,
)
from lib.planner.meta_campaign_spec import (
    meta_content_missing_lines,
    plan_meta_create_workflow,
)
from lib.planner.orchestrator import (
    classify_workflow_intent_with_planner,
    resolve_ads_mode_from_intent,
    resolve_ads_platform_from_intent,
    workflow_intent_from_ctx,
)
from lib.planner.planner_trace import PlannerTrace

AdsPlatform = Literal['meta_ads', 'google_ads', 'unknown']
AdsMode = Literal[
    'create',
    'report',
    'list',
    'pause',
    'optimize',
    'audience',
    'schedule',
    'budget_pacing',
    'budget_reallocation',
    'bid_optimization',
    'quality_score',
    'asset_ab',
    'generate_assets',
]


def is_actionable_ads_request(message: str) -> bool:
    m = (message or '').lower()
    if len(m) < 6:
        return False
    ads_channel = any(
        k in m
        for k in (
            'google ads',
            'google ad',
            'meta ads',
            'facebook ads',
            'fb ads',
            'instagram ads',
            'ad account',
            'ad campaign',
            'ad set',
            'adset',
            'rsa',
            'search campaign',
            'gaql',
            'remarketing',
            'daypart',
            'meta advertising',
            'google advertising',
            'advertising setup',
            'meta campaign',
            'facebook campaign',
            'meta ad',
            'advertising campaign',
        )
    ) or (
        'google' in m
        and any(k in m for k in ('advertising', 'ad campaign', 'advertising setup', 'search campaign'))
    ) or (
        'meta' in m
        and any(k in m for k in ('campaign', 'targeting', 'pixel', 'advertising', 'creatives'))
    ) or (
        'advertising' in m
        and any(k in m for k in ('campaign', 'setup', 'targeting', 'creatives', 'structure'))
    )
    action = any(
        k in m
        for k in (
            'create',
            'launch',
            'publish',
            'build',
            'set up',
            'setup',
            'start',
            'report',
            'performance',
            'insights',
            'metrics',
            'list',
            'show',
            'pause',
            'stop',
            'optimize',
            'improve',
            'adjust',
            'audience',
            'schedule',
            'negative',
            'wasted',
        )
    )
    return ads_channel and action


def detect_ads_platform(message: str, ctx: dict[str, Any]) -> AdsPlatform:
    m = (message or '').lower()
    if any(
        k in m
        for k in (
            'google ads',
            'google ad',
            'google advertising',
            'google search',
            'rsa',
            'gaql',
            'remarketing',
            'daypart',
        )
    ):
        return 'google_ads'
    if 'google' in m and any(
        k in m for k in ('advertising', 'ad campaign', 'ad setup', 'advertising setup', 'search campaign')
    ):
        return 'google_ads'
    if any(
        k in m
        for k in (
            'meta ads',
            'facebook ads',
            'fb ads',
            'instagram ads',
            'ad set',
            'adset',
            'meta advertising',
            'meta campaign',
            'meta ad',
            'facebook campaign',
        )
    ):
        return 'meta_ads'
    if 'meta' in m and any(
        k in m for k in ('campaign', 'targeting', 'pixel', 'advertising', 'creatives', 'ad account')
    ):
        return 'meta_ads'
    accounts = ctx.get('ads_accounts') or []
    google = [a for a in accounts if (a.get('provider') or '') == 'google_ads']
    meta = [a for a in accounts if (a.get('provider') or '') == 'meta_ads']
    if len(google) == 1 and not meta:
        return 'google_ads'
    if len(meta) == 1 and not google:
        return 'meta_ads'
    if google and not meta:
        return 'google_ads'
    if meta and not google:
        return 'meta_ads'
    return 'unknown'


def detect_ads_mode(message: str) -> AdsMode:
    m = (message or '').lower()
    if any(k in m for k in ('audience', 'remarketing', 'retarget', 'user list')):
        return 'audience'
    if any(k in m for k in ('schedule', 'daypart', 'hours', 'time of day', 'run ads only')):
        return 'schedule'
    if re.search(r'\b(budget pacing|pacing|overspend|underspend|burn rate)\b', m):
        return 'budget_pacing'
    if re.search(r'\b(reallocat|shift budget|move budget)\b', m):
        return 'budget_reallocation'
    if re.search(r'\b(bid optim|optimize bids|cpa target|roas target)\b', m):
        return 'bid_optimization'
    if re.search(r'\b(quality score|qs monitor)\b', m):
        return 'quality_score'
    if re.search(r'\b(asset a/b|a/b test|ab test|ad variant)\b', m):
        return 'asset_ab'
    if re.search(r'\b(generate assets|rsa copy|ad copy|headlines for campaign)\b', m):
        return 'generate_assets'
    if any(
        k in m
        for k in (
            'optimize',
            'improve',
            'bid adjustment',
            'bid modifier',
            'wasted',
            'negative keyword',
            'search term',
            'geographic',
            'geo performance',
            'device performance',
            'recommendation',
        )
    ):
        return 'optimize'
    if any(k in m for k in ('report', 'performance', 'insights', 'metrics', 'analytics', 'how did', 'how are')):
        return 'report'
    if any(k in m for k in ('list', 'show me', 'what campaigns', 'which campaigns')):
        return 'list'
    if any(k in m for k in ('pause', 'stop', 'disable')):
        return 'pause'
    return 'create'


def _account_row_id(row: dict[str, Any]) -> str:
    return str(row.get('id') or row.get('account_id') or '').strip()


def _is_graph_ad_account_row(row: dict[str, Any]) -> bool:
    if str(row.get('ad_account_id') or '').strip():
        return True
    username = str(row.get('username') or '').strip()
    return username.startswith('act_')


def _prefer_ads_account_row(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not rows:
        return None
    with_act = [r for r in rows if _is_graph_ad_account_row(r)]
    pool = with_act if with_act else rows
    authorized = [r for r in pool if r.get('authorized') is not False]
    pool = authorized if authorized else pool
    return pool[0]


def _pick_ads_account_id(platform: AdsPlatform, ctx: dict[str, Any]) -> str | None:
    accounts = ctx.get('ads_accounts') or []
    if platform != 'unknown':
        matches = [a for a in accounts if (a.get('provider') or '') == platform]
        picked = _prefer_ads_account_row(matches)
        if picked:
            return _account_row_id(picked)
    if len(accounts) == 1:
        return _account_row_id(accounts[0])
    meta = [a for a in accounts if (a.get('provider') or '') == 'meta_ads']
    google = [a for a in accounts if (a.get('provider') or '') == 'google_ads']
    if platform == 'unknown' or platform == 'meta_ads':
        picked = _prefer_ads_account_row(meta)
        if picked:
            return _account_row_id(picked)
    if platform == 'unknown' or platform == 'google_ads':
        picked = _prefer_ads_account_row(google)
        if picked:
            return _account_row_id(picked)
    return None


def _infer_platform_for_account(ctx: dict[str, Any], account_id: str) -> AdsPlatform:
    for row in ctx.get('ads_accounts') or []:
        if _account_row_id(row) == account_id:
            prov = str(row.get('provider') or '')
            if prov == 'google_ads':
                return 'google_ads'
            if prov == 'meta_ads':
                return 'meta_ads'
    return 'unknown'


def _ads_account_resolution_error(ctx: dict[str, Any], platform: AdsPlatform) -> str:
    accounts = ctx.get('ads_accounts') or []
    if not accounts:
        return (
            'No Meta/Google Ads accounts found for this workspace. Connect Meta Ads under Accounts '
            '(Ads tab), then try again.'
        )
    if platform != 'unknown':
        matches = [a for a in accounts if (a.get('provider') or '') == platform]
        if not matches:
            return (
                f'No {platform.replace("_", " ")} account in this workspace. '
                'Connect the matching ads platform under Accounts.'
            )
    return (
        'Could not pick a single ads account automatically. '
        'Open Accounts and keep one Meta Ads connection with an ad account (act_*) selected.'
    )


def _default_campaign_name(prompt: str) -> str:
    """Unique default when user did not name the campaign (avoids Google duplicate-name errors)."""
    from datetime import datetime, timezone
    from urllib.parse import urlparse

    text = prompt or ''
    stamp = datetime.now(timezone.utc).strftime('%m%d-%H%M')
    url_m = re.search(r'https?://[^\s\'"]+', text, re.I)
    if url_m:
        try:
            host = urlparse(url_m.group(0)).netloc.replace('www.', '')
            brand = (host.split('.')[0] or '').strip()
            if len(brand) >= 3:
                kind = 'Search' if re.search(r'\bsearch\b', text, re.I) else 'Ads'
                return f'{brand.title()} {kind} {stamp}'
        except Exception:
            pass
    kind = 'Search' if re.search(r'\bsearch\b', text, re.I) else 'Campaign'
    return f'{kind} {stamp}'


def _extract_campaign_name(message: str) -> str:
    m = message.strip()
    quoted = re.search(r'["\']([^"\']{3,80})["\']', m)
    if quoted:
        return quoted.group(1).strip()
    for prefix in ('called ', 'named '):
        if prefix in m.lower():
            idx = m.lower().index(prefix) + len(prefix)
            tail = m[idx:].split('.')[0].split(',')[0].strip()
            if 3 <= len(tail) <= 80:
                return tail
    return _default_campaign_name(m)


def _extract_campaign_id(message: str) -> str | None:
    m = message or ''
    for pat in (
        r'campaign\s*(?:id\s*)?[#:]?\s*(\d{6,})',
        r'\bid\s*(\d{6,})',
        r'\b(\d{10,})\b',
    ):
        hit = re.search(pat, m, re.I)
        if hit:
            return hit.group(1)
    return None


def _meta_objective_from_prompt(prompt: str) -> str:
    m = prompt.lower()
    if any(k in m for k in ('sales', 'conversion', 'purchase', 'roas')):
        return 'OUTCOME_SALES'
    if any(k in m for k in ('lead', 'leads')):
        return 'OUTCOME_LEADS'
    if any(k in m for k in ('awareness', 'reach')):
        return 'OUTCOME_AWARENESS'
    if any(k in m for k in ('engagement', 'post engagement')):
        return 'OUTCOME_ENGAGEMENT'
    if any(k in m for k in ('app install', 'app promotion')):
        return 'OUTCOME_APP_PROMOTION'
    return 'OUTCOME_TRAFFIC'


def _extract_geo_countries(prompt: str) -> list[str]:
    """ISO country codes from user message (default US)."""
    m = (prompt or '').lower()
    if 'morocco' in m:
        return ['MA']
    if 'france' in m:
        return ['FR']
    if 'spain' in m:
        return ['ES']
    if any(k in m for k in ('united states', 'usa', ' u.s.', ' us ')):
        return ['US']
    return ['US']


_IMAGE_URL_SUFFIX_RE = re.compile(r'\.(jpg|jpeg|png|gif|webp)(\?|$)', re.I)


def primary_image_attachment(ctx: dict[str, Any]) -> dict[str, Any] | None:
    for row in ctx.get('attached_media') or []:
        mime = str(row.get('mime_type') or '')
        if mime.startswith('image/') and row.get('id'):
            return row
    return None


def _public_image_url_from_prompt(prompt: str) -> str | None:
    for raw in re.findall(r'https?://[^\s<>"\']+', prompt or ''):
        url = raw.rstrip('.,)')
        if _IMAGE_URL_SUFFIX_RE.search(url):
            return url
    return None


def _has_image_source(ctx: dict[str, Any], prompt: str) -> bool:
    return bool(primary_image_attachment(ctx) or _public_image_url_from_prompt(prompt))


def _resolve_image_url(ctx: dict[str, Any], prompt: str) -> str | None:
    """Public HTTPS image URL only — library attachments use media_id instead."""
    return _public_image_url_from_prompt(prompt)


def _extract_destination_url(prompt: str) -> str | None:
    """Shop/landing URL — skips URLs that look like direct image files."""
    for raw in re.findall(r'https?://[^\s<>"\']+', prompt or ''):
        url = raw.rstrip('.,)')
        if _IMAGE_URL_SUFFIX_RE.search(url):
            continue
        return url
    return None


def _looks_like_url_only(message: str) -> bool:
    return bool(re.match(r'^https?://\S+$', (message or '').strip()))


def _is_meta_collection_assistant_message(content: str) -> bool:
    """True when assistant is collecting Meta campaign fields."""
    return is_assistant_collecting_ads_fields(content)


def _is_google_collection_assistant_message(content: str) -> bool:
    """True when assistant is collecting Google campaign fields."""
    c = content or ''
    return any(
        marker in c
        for marker in (
            'Google Campaign Setup',
            'Google Campaign Review',
            'Collect Google campaign details',
            'Campaign type** — Search, Display',
            'Merchant Center ID',
            'Type APPROVE to continue',
            'Still need:',
            'Got it — Campaign type',
            '• **End date**',
            'End date:',
        )
    )


def is_google_campaign_collection_active(
    conversation_history: list[dict[str, Any]] | None,
) -> bool:
    """Ongoing Google create collection — user follow-ups must stay on the ads path."""
    from lib.planner.google_campaign_spec import is_google_review_message

    history = list(conversation_history or [])
    for msg in reversed(history):
        if msg.get('role') != 'assistant':
            continue
        content = str(msg.get('content') or '')
        if is_google_review_message(content):
            return False
        if _is_google_collection_assistant_message(content):
            return True
    return False


def is_meta_campaign_collection_active(
    conversation_history: list[dict[str, Any]] | None,
) -> bool:
    """Ongoing Meta CBO create collection — user follow-ups must stay on the ads path."""
    from lib.planner.meta_campaign_spec import is_meta_review_message

    history = list(conversation_history or [])
    for msg in reversed(history):
        if msg.get('role') != 'assistant':
            continue
        content = str(msg.get('content') or '')
        if is_meta_review_message(content):
            return False
        if _is_meta_collection_assistant_message(content):
            return True
    return False


_SCHEDULE_REPLY_RE = re.compile(
    r'\b(?:start|starts|starting|begin|end|ends|ending|until|tomorrow|tomorow|next\s+week)\b',
    re.I,
)
_OBJECTIVE_REPLY_RE = re.compile(
    r'\b(traffic|awareness|engagement|leads|sales|app promotion|'
    r'outcome_traffic|outcome_awareness|outcome_engagement|outcome_leads|'
    r'outcome_sales|outcome_app_promotion)\b',
    re.I,
)
_BUDGET_REPLY_RE = re.compile(
    r'(?:\$\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*\$|\d+(?:\.\d+)?\s*/\s*day|\$\d+(?:\.\d+)?\s*/?\s*day)',
    re.I,
)


def merge_conversation_attachments(
    attached_media: list[dict[str, Any]] | None,
    conversation_history: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Carry library attachments from earlier turns (e.g. image sent before URL follow-up)."""
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for row in list(attached_media or []):
        mid = str(row.get('id') or '')
        if mid and mid not in seen:
            seen.add(mid)
            out.append(dict(row))
    for msg in reversed(conversation_history or []):
        if msg.get('role') != 'user':
            continue
        for row in msg.get('attachments') or []:
            mid = str(row.get('id') or '')
            if mid and mid not in seen:
                seen.add(mid)
                out.append(dict(row))
    return out


def _mentions_ads(message: str) -> bool:
    if is_actionable_ads_request(message):
        return True
    m = (message or '').lower()
    if len(m) < 8:
        return False
    return any(
        k in m
        for k in (
            'meta advertising',
            'advertising setup',
            'meta campaign',
            'facebook campaign',
        )
    )


def is_ads_clarification_followup(
    user_message: str,
    conversation_history: list[dict[str, Any]] | None,
) -> bool:
    """User is replying during Meta/Google ads setup collection."""
    current = (user_message or '').strip()
    if not current:
        return False
    history = list(conversation_history or [])
    if not history:
        return False

    from lib.planner.meta_campaign_spec import is_meta_campaign_approval
    from lib.planner.google_campaign_spec import is_google_campaign_approval
    from lib.planner.social_fallback import is_actionable_social_request

    if is_meta_campaign_approval(current, history):
        return True

    if is_google_campaign_approval(current, history):
        return True

    if not is_ads_collection_active(history):
        return False

    if is_actionable_social_request(current) and not is_short_ads_followup_reply(current):
        return False

    return is_short_ads_followup_reply(current)


def resolve_ads_planning_message(
    user_message: str,
    conversation_history: list[dict[str, Any]] | None,
) -> str:
    """Merge short follow-ups (page, objective, budget, URL, APPROVE) with earlier ads context."""
    current = (user_message or '').strip()
    history = list(conversation_history or [])

    if is_ads_clarification_followup(current, history):
        return merge_ads_conversation_user_messages(current, history)

    if _mentions_ads(current):
        return current

    from lib.planner.meta_campaign_spec import is_meta_campaign_approval
    from lib.planner.google_campaign_spec import is_google_campaign_approval

    history = list(conversation_history or [])
    if is_meta_campaign_approval(current, history):
        chunks: list[str] = []
        for msg in history:
            if msg.get('role') != 'user':
                continue
            text = str(msg.get('content') or '').strip()
            if text and not re.search(r'\b(APPROVE|yes, create it|create campaign)\b', text, re.I):
                chunks.append(text)
        if chunks:
            return f'{"\n\n".join(chunks)}\n\n{current}'.strip()

    if is_google_campaign_approval(current, history):
        chunks = []
        for msg in history:
            if msg.get('role') != 'user':
                continue
            text = str(msg.get('content') or '').strip()
            if text and not re.search(r'\b(APPROVE|yes, create it|create campaign)\b', text, re.I):
                chunks.append(text)
        if chunks:
            return f'{"\n\n".join(chunks)}\n\n{current}'.strip()

    return current


def _meta_discovery_steps(base: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {'step_id': 'step_1', 'tool_id': 'meta_get_account', 'payload': dict(base), 'depends_on': []},
        {
            'step_id': 'step_2',
            'tool_id': 'meta_get_account_pages',
            'payload': dict(base),
            'depends_on': ['step_1'],
        },
    ]


def _meta_creative_assets(ctx: dict[str, Any], prompt: str) -> tuple[str | None, str | None, str | None]:
    """Return (media_id, public_image_url, link_url) — all None when missing."""
    attachment = primary_image_attachment(ctx)
    media_id = str(attachment.get('id') or '') if attachment else None
    image_url = _public_image_url_from_prompt(prompt)
    link_url = _extract_destination_url(prompt)
    return media_id or None, image_url, link_url


def _meta_creative_copy(
    name: str,
    prompt: str,
    *,
    objective: str = 'OUTCOME_TRAFFIC',
    workspace_id: str | None = None,
    conversation_history: list[dict[str, Any]] | None = None,
    link_url: str | None = None,
) -> tuple[str, str]:
    from lib.planner.meta_campaign_llm import resolve_meta_ad_copy

    message, headline, _description, _source = resolve_meta_ad_copy(
        campaign_name=name,
        objective=objective,
        prompt=prompt,
        conversation_history=conversation_history,
        workspace_id=workspace_id,
        link_url=link_url,
    )
    return message, headline


def _meta_create_mode(prompt: str, *, has_image: bool) -> Literal['strategy', 'draft', 'publish']:
    m = (prompt or '').lower()
    if any(
        k in m
        for k in (
            'recommend',
            'recommendation',
            'strategy',
            'suggest targeting',
            'audience research',
            'plan only',
            'ideas only',
            'what should i',
        )
    ):
        return 'strategy'
    if any(
        k in m
        for k in ('launch now', 'one-shot', 'one shot', 'quick publish', 'publish now', 'go live', 'run ads now')
    ):
        return 'publish'
    if has_image and any(k in m for k in ('publish', 'launch', 'go live', 'full ad', 'with creative')):
        return 'publish'
    return 'draft'


def _meta_optimization_goal(objective: str) -> str:
    if objective == 'OUTCOME_SALES':
        return 'OFFSITE_CONVERSIONS'
    if objective == 'OUTCOME_LEADS':
        return 'LINK_CLICKS'
    if objective == 'OUTCOME_AWARENESS':
        return 'REACH'
    if objective == 'OUTCOME_ENGAGEMENT':
        return 'POST_ENGAGEMENT'
    if objective == 'OUTCOME_APP_PROMOTION':
        return 'APP_INSTALLS'
    return 'LINK_CLICKS'


def _meta_targeting_block(name: str, og: str, countries: list[str]) -> dict[str, Any]:
    return {
        'adset_name': f'{name} — Ad Set',
        'optimization_goal': og,
        'billing_event': 'IMPRESSIONS',
        'geo_locations': {'countries': countries},
    }


def _meta_strategy_steps(
    base: dict[str, Any],
    prompt: str,
    *,
    ctx: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """Read-only audience/geo research — no Meta writes."""
    from lib.planner.meta_campaign_llm import resolve_meta_strategy_queries

    countries = _extract_geo_countries(prompt)
    history = (ctx or {}).get('conversation_history')
    workspace_id = base.get('workspace_id')
    geo_query, interest_query = resolve_meta_strategy_queries(
        prompt=prompt,
        conversation_history=history,
        workspace_id=str(workspace_id) if workspace_id else None,
        geo_countries=countries,
    )
    return [
        {'step_id': 'step_1', 'tool_id': 'meta_get_account', 'payload': dict(base), 'depends_on': []},
        {
            'step_id': 'step_2',
            'tool_id': 'meta_search_geo_locations',
            'payload': {**base, 'query': geo_query, 'location_types': ['country']},
            'depends_on': ['step_1'],
        },
        {
            'step_id': 'step_3',
            'tool_id': 'meta_search_interests',
            'payload': {**base, 'query': interest_query},
            'depends_on': ['step_1'],
        },
        {
            'step_id': 'step_4',
            'tool_id': 'meta_estimate_audience_size',
            'payload': {
                **base,
                'targeting': {'geo_locations': {'countries': countries}},
                'optimization_goal': 'REACH',
            },
            'depends_on': ['step_2', 'step_3'],
        },
    ]


def _meta_granular_create_steps(
    base: dict[str, Any],
    name: str,
    *,
    objective: str,
    prompt: str,
    media_id: str | None,
    image_url: str | None,
    link_url: str,
    page_ids: list[str],
) -> list[dict[str, Any]]:
    """Guide §7 — account → upload → campaign → adset → creative(s) → ad(s), paused on Meta."""
    if not page_ids:
        raise ValueError('page_ids required for Meta granular create')

    og = _meta_optimization_goal(objective)
    countries = _extract_geo_countries(prompt)
    message, headline = _meta_creative_copy(
        name,
        prompt,
        objective=objective,
        workspace_id=str(base.get('workspace_id') or '') or None,
        conversation_history=None,
        link_url=link_url,
    )
    steps: list[dict[str, Any]] = [
        {'step_id': 'step_1', 'tool_id': 'meta_get_account', 'payload': dict(base), 'depends_on': []},
    ]
    next_id = 2
    pixel_step: str | None = None
    if objective == 'OUTCOME_SALES' and og in ('OFFSITE_CONVERSIONS', 'VALUE'):
        pixel_step = f'step_{next_id}'
        steps.append({
            'step_id': pixel_step,
            'tool_id': 'meta_list_ad_pixels',
            'payload': dict(base),
            'depends_on': ['step_1'],
        })
        next_id += 1

    upload_payload: dict[str, Any] = {**base, 'name': f'{name} — Image'}
    if media_id:
        upload_payload['media_id'] = media_id
    elif image_url:
        upload_payload['image_url'] = image_url
    steps.append({
        'step_id': f'step_{next_id}',
        'tool_id': 'meta_upload_ad_image',
        'payload': upload_payload,
        'depends_on': ['step_1'],
        'requires_approval': True,
    })
    upload_step = f'step_{next_id}'
    next_id += 1

    steps.append({
        'step_id': f'step_{next_id}',
        'tool_id': 'meta_create_campaign',
        'payload': {
            **base,
            'name': name,
            'objective': objective,
            'use_adset_level_budgets': True,
        },
        'depends_on': ['step_1'],
        'requires_approval': True,
    })
    campaign_step = f'step_{next_id}'
    next_id += 1

    adset_payload: dict[str, Any] = {
        **base,
        'name': f'{name} — Ad Set',
        'campaign_id': f'${campaign_step}.output.platform_campaign_id',
        'objective': objective,
        'optimization_goal': og,
        'billing_event': 'IMPRESSIONS',
        'daily_budget': 1000,
        'targeting': _meta_targeting_block(name, og, countries),
    }
    if pixel_step:
        adset_payload['pixel_id'] = f'${pixel_step}.output.default_pixel_id'
    steps.append({
        'step_id': f'step_{next_id}',
        'tool_id': 'meta_create_adset',
        'payload': adset_payload,
        'depends_on': [campaign_step],
        'requires_approval': True,
    })
    adset_step = f'step_{next_id}'
    next_id += 1

    for idx, page_id in enumerate(page_ids):
        suffix = f' — Page {idx + 1}' if len(page_ids) > 1 else ''
        steps.append({
            'step_id': f'step_{next_id}',
            'tool_id': 'meta_create_creative',
            'payload': {
                **base,
                'page_id': page_id,
                'link_url': link_url,
                'image_hash': f'${upload_step}.output.image_hash',
                'message': message,
                'headline': headline,
                'name': f'{name} — Creative{suffix}',
            },
            'depends_on': [upload_step],
            'requires_approval': True,
        })
        creative_step = f'step_{next_id}'
        next_id += 1

        steps.append({
            'step_id': f'step_{next_id}',
            'tool_id': 'meta_create_ad',
            'payload': {
                **base,
                'adset_id': f'${adset_step}.output.platform_ad_set_id',
                'creative_id': f'${creative_step}.output.creative_id',
                'name': f'{name} — Ad{suffix}',
            },
            'depends_on': [adset_step, creative_step],
            'requires_approval': True,
        })
        next_id += 1

    return steps


def _meta_quick_publish_steps(
    base: dict[str, Any],
    name: str,
    *,
    objective: str,
    prompt: str,
    media_id: str | None,
    image_url: str | None,
    link_url: str,
    page_id: str,
) -> list[dict[str, Any]]:
    """Guide §8 — meta_publish_campaign with a resolved Facebook Page."""
    og = _meta_optimization_goal(objective)
    countries = _extract_geo_countries(prompt)
    message, headline = _meta_creative_copy(
        name,
        prompt,
        objective=objective,
        workspace_id=str(base.get('workspace_id') or '') or None,
        conversation_history=None,
        link_url=link_url,
    )
    steps: list[dict[str, Any]] = [
        {'step_id': 'step_1', 'tool_id': 'meta_get_account', 'payload': dict(base), 'depends_on': []},
    ]
    publish_dep = ['step_1']
    if objective == 'OUTCOME_SALES' and og in ('OFFSITE_CONVERSIONS', 'VALUE'):
        steps.append({
            'step_id': 'step_2',
            'tool_id': 'meta_list_ad_pixels',
            'payload': dict(base),
            'depends_on': ['step_1'],
        })
        publish_dep.append('step_2')

    publish_payload: dict[str, Any] = {
        **base,
        'name': name,
        'objective': objective,
        'page_id': page_id,
        'budget': {'amount': 1000},
        'targeting': _meta_targeting_block(name, og, countries),
        'creatives': {
            'page_id': page_id,
            'link_url': link_url,
            'message': message,
            'headline': headline,
        },
    }
    if media_id:
        publish_payload['media_id'] = media_id
    elif image_url:
        publish_payload['creatives']['image_url'] = image_url
    if objective == 'OUTCOME_SALES' and og in ('OFFSITE_CONVERSIONS', 'VALUE'):
        publish_payload['pixel_id'] = '${step_2}.output.default_pixel_id'

    steps.append({
        'step_id': f'step_{len(steps) + 1}',
        'tool_id': 'meta_publish_campaign',
        'payload': publish_payload,
        'depends_on': publish_dep,
        'requires_approval': True,
    })
    return steps


def _google_granular_create_steps(
    base: dict[str, Any],
    name: str,
    *,
    prompt: str,
    ctx: dict[str, Any],
) -> list[dict[str, Any]]:
    """Step-by-step Google Search chain — marketing assets from AI pipeline, not hardcoded demos."""
    from lib.planner.google_campaign_llm import (
        infer_business_context_from_prompt,
        resolve_google_ad_copy,
    )
    from lib.planner.google_keyword_pipeline import run_search_keyword_pipeline
    from lib.planner.meta_campaign_spec import (
        extract_daily_budget,
        extract_destination_url,
        full_conversation_text,
    )

    history = ctx.get('conversation_history') or []
    full_text = full_conversation_text(prompt, history)
    workspace_id = str(base.get('workspace_id') or ctx.get('workspace_id') or '') or None
    final_url = extract_destination_url(full_text)
    if not final_url:
        raise RuntimeError(
            'Destination URL is required for Google Search campaign fallback. '
            'Include a https:// link in your message.'
        )
    daily_budget = extract_daily_budget(full_text)
    if daily_budget is None:
        raise RuntimeError(
            'Daily budget is required for Google Search campaign fallback. '
            'Include an amount such as $25/day in your message.'
        )
    business_context = infer_business_context_from_prompt(full_text)

    pipeline = run_search_keyword_pipeline(
        prompt=full_text,
        conversation_history=history,
        business_context=business_context,
        geo_countries=None,
        geo_target_constant_ids=None,
        final_url=final_url,
        base_payload=base,
        workspace_id=workspace_id,
    )
    keyword_entries = [
        {'text': kw, 'match_type': 'BROAD'}
        for kw in (pipeline.keywords or [])[:8]
    ]
    if not keyword_entries:
        keyword_entries = [{'text': business_context or name, 'match_type': 'BROAD'}]

    headlines, descriptions, _copy_source = resolve_google_ad_copy(
        campaign_name=name,
        prompt=full_text,
        conversation_history=history,
        business_context=business_context,
        final_url=final_url,
        campaign_type='search',
        geo_countries=None,
        workspace_id=workspace_id,
    )

    return [
        {'step_id': 'step_1', 'tool_id': 'google_get_account', 'payload': dict(base), 'depends_on': []},
        {
            'step_id': 'step_2',
            'tool_id': 'google_create_budget',
            'payload': {**base, 'name': f'{name} — Budget', 'daily_budget': daily_budget},
            'depends_on': ['step_1'],
        },
        {
            'step_id': 'step_3',
            'tool_id': 'google_create_typed_campaign',
            'payload': {**base, 'name': name, 'status': 'PAUSED', 'campaign_type': 'SEARCH'},
            'depends_on': ['step_2'],
            'requires_approval': True,
        },
        {
            'step_id': 'step_4',
            'tool_id': 'google_create_adgroup',
            'payload': {**base, 'name': f'{name} — Ad group', 'status': 'PAUSED'},
            'depends_on': ['step_3'],
        },
        {
            'step_id': 'step_5',
            'tool_id': 'google_add_keywords',
            'payload': {**base, 'keyword_entries': keyword_entries},
            'depends_on': ['step_4'],
        },
        {
            'step_id': 'step_6',
            'tool_id': 'google_create_ad',
            'payload': {
                **base,
                'final_url': final_url,
                'headlines': headlines[:8],
                'descriptions': descriptions[:3],
                'status': 'PAUSED',
            },
            'depends_on': ['step_5'],
            'requires_approval': True,
        },
    ]


def _google_optimize_workflow(base: dict[str, Any], prompt: str, campaign_id: str | None) -> dict[str, Any]:
    m = prompt.lower()
    camp_payload = {**base}
    if campaign_id:
        camp_payload['platform_campaign_id'] = campaign_id

    steps: list[dict[str, Any]] = [
        {'step_id': 'step_1', 'tool_id': 'google_get_account', 'payload': dict(base), 'depends_on': []},
    ]

    summary = 'Google optimization workflow.'
    assistant = 'Review read steps before approving any bid or negative keyword writes.'

    if 'negative' in m or 'search term' in m or 'wasted' in m:
        steps.append({
            'step_id': 'step_2',
            'tool_id': 'google_suggest_negative_keywords',
            'payload': {**camp_payload, 'date_range': 'LAST_30_DAYS', 'min_cost': 5},
            'depends_on': ['step_1'],
        })
        summary = 'Suggest wasted search terms; review before adding negatives.'
        assistant = (
            'I will suggest high-cost search terms. After review, run google_add_negative_keywords '
            'with the terms you want to block (requires campaign id).'
        )
    elif 'device' in m:
        steps.extend([
            {
                'step_id': 'step_2',
                'tool_id': 'google_get_device_performance',
                'payload': {**camp_payload, 'date_range': 'LAST_30_DAYS'},
                'depends_on': ['step_1'],
            },
            {
                'step_id': 'step_3',
                'tool_id': 'google_set_bid_adjustments',
                'payload': {
                    **camp_payload,
                    'adjustments': {'device': {'mobile': 1.1, 'desktop': 1.0, 'tablet': 1.05}},
                },
                'depends_on': ['step_2'],
                'requires_approval': True,
            },
        ])
        summary = 'Device performance → bid adjustments (edit modifiers before approving step 3).'
        assistant = summary
    else:
        steps.extend([
            {
                'step_id': 'step_2',
                'tool_id': 'google_optimize_geographic_targeting',
                'payload': {**camp_payload, 'date_range': 'LAST_30_DAYS'},
                'depends_on': ['step_1'],
            },
            {
                'step_id': 'step_3',
                'tool_id': 'google_set_bid_adjustments',
                'payload': {
                    **camp_payload,
                    'adjustments': {'location': {'2840': 1.15}},
                },
                'depends_on': ['step_2'],
                'requires_approval': True,
            },
        ])
        summary = 'Geo optimization hints → location bid adjustments (approval on write step).'
        assistant = (
            'Step 2 returns recommended geo_target_id and suggested_bid_modifier values. '
            'Edit step 3 adjustments JSON to match before approving.'
        )

    if not campaign_id:
        assistant += ' Include campaign id in your message (e.g. campaign id 123456789) for scoped results.'
        summary += ' Add campaign id for scoped analysis.'

    gates = [s['step_id'] for s in steps if s.get('requires_approval')]
    return {
        'intent': 'analytics',
        'summary': summary,
        'assistant_message': assistant,
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': gates,
    }


def _google_audience_workflow(base: dict[str, Any], prompt: str) -> dict[str, Any]:
    m = prompt.lower()
    use_existing = 'existing' in m or 'list' in m
    steps: list[dict[str, Any]] = [
        {'step_id': 'step_1', 'tool_id': 'google_get_account', 'payload': dict(base), 'depends_on': []},
    ]
    if use_existing:
        steps.append({
            'step_id': 'step_2',
            'tool_id': 'google_list_audiences',
            'payload': dict(base),
            'depends_on': ['step_1'],
        })
        steps.append({
            'step_id': 'step_3',
            'tool_id': 'google_add_audience_targeting',
            'payload': {
                **base,
                'audience_id': 'REPLACE_WITH_USER_LIST_ID',
                'bid_modifier': 1.1,
            },
            'depends_on': ['step_2'],
            'requires_approval': True,
        })
        msg = 'List audiences → attach to ad group (set audience_id and platform_ad_set_id before approving).'
    else:
        steps.extend([
            {
                'step_id': 'step_2',
                'tool_id': 'google_create_custom_audience',
                'payload': {
                    **base,
                    'name': 'Website visitors',
                    'audience_type': 'WEBSITE_VISITORS',
                    'rules': {'url_contains': '/'},
                },
                'depends_on': ['step_1'],
                'requires_approval': True,
            },
            {
                'step_id': 'step_3',
                'tool_id': 'google_add_audience_targeting',
                'payload': {**base, 'audience_id': 'FROM_STEP_2', 'bid_modifier': 1.1},
                'depends_on': ['step_2'],
                'requires_approval': True,
            },
        ])
        msg = (
            'Create remarketing list → attach to ad group. Use audience_id from step 2 output '
            'and platform_ad_set_id from your campaign publish.'
        )
    return {
        'intent': 'ads_campaign',
        'summary': 'Google audience: list or create → ad group targeting.',
        'assistant_message': msg,
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': [s['step_id'] for s in steps if s.get('requires_approval')],
    }


def _budget_workspace_payload(ctx: dict[str, Any]) -> dict[str, Any]:
    return {'workspace_id': ctx.get('workspace_id')}


def _budget_pacing_workflow(ctx: dict[str, Any], prompt: str) -> dict[str, Any]:
    payload = _budget_workspace_payload(ctx)
    steps = [{
        'step_id': 'step_1',
        'tool_id': 'run_budget_pacing',
        'payload': dict(payload),
        'depends_on': [],
    }]
    return {
        'intent': 'ads_campaign',
        'summary': 'Analyze workspace budget pacing vs monthly targets.',
        'assistant_message': 'I will compare spend to allocated budget and flag overspending campaigns.',
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': [],
    }


def _budget_reallocation_workflow(ctx: dict[str, Any], prompt: str) -> dict[str, Any]:
    payload = _budget_workspace_payload(ctx)
    steps = [{
        'step_id': 'step_1',
        'tool_id': 'run_budget_reallocation',
        'payload': dict(payload),
        'depends_on': [],
    }]
    return {
        'intent': 'ads_campaign',
        'summary': 'Recommend budget shifts between campaigns by performance.',
        'assistant_message': 'Review suggested shifts before applying budget changes in the Budget panel.',
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': [],
    }


def _bid_optimization_workflow(ctx: dict[str, Any], prompt: str, campaign_id: str | None) -> dict[str, Any]:
    payload = {**_budget_workspace_payload(ctx)}
    if campaign_id:
        payload['campaign_id'] = campaign_id
    steps = [{
        'step_id': 'step_1',
        'tool_id': 'run_bid_optimization',
        'payload': payload,
        'depends_on': [],
    }]
    return {
        'intent': 'ads_campaign',
        'summary': 'CPA/ROAS bid recommendations at campaign and keyword level.',
        'assistant_message': 'Review keyword bid recommendations before applying writes.',
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': [],
    }


def _quality_score_workflow(ctx: dict[str, Any], prompt: str, campaign_id: str | None) -> dict[str, Any]:
    payload = {**_budget_workspace_payload(ctx)}
    if campaign_id:
        payload['campaign_id'] = campaign_id
    steps = [{
        'step_id': 'step_1',
        'tool_id': 'run_quality_score_monitor',
        'payload': payload,
        'depends_on': [],
    }]
    return {
        'intent': 'ads_campaign',
        'summary': 'Monitor Google Ads Quality Scores and flagged keywords.',
        'assistant_message': 'Low QS keywords need tighter ad groups and stronger RSA relevance.',
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': [],
    }


def _asset_ab_workflow(ctx: dict[str, Any], prompt: str, campaign_id: str | None) -> dict[str, Any]:
    payload = {**_budget_workspace_payload(ctx)}
    if campaign_id:
        payload['campaign_id'] = campaign_id
    steps = [{
        'step_id': 'step_1',
        'tool_id': 'run_asset_ab_analysis',
        'payload': payload,
        'depends_on': [],
    }]
    return {
        'intent': 'ads_campaign',
        'summary': 'Compare ad variants within ad groups for A/B winners.',
        'assistant_message': 'Review experiments before pausing losing ad variants.',
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': [],
    }


def _generate_assets_workflow(
    ctx: dict[str, Any],
    prompt: str,
    campaign_id: str | None,
    campaign_name: str | None,
) -> dict[str, Any]:
    if not campaign_id:
        return {
            'intent': 'informational',
            'summary': 'Campaign id required to generate RSA assets.',
            'assistant_message': 'Provide a campaign id (Mongo _id) or name from your campaigns list.',
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
        }
    name = campaign_name or _extract_campaign_name(prompt) or 'Campaign'
    payload = {
        'workspace_id': ctx.get('workspace_id'),
        'campaign_id': campaign_id,
        'campaign_name': name,
        'keywords': [],
    }
    steps = [{
        'step_id': 'step_1',
        'tool_id': 'generate_campaign_assets',
        'payload': payload,
        'depends_on': [],
    }]
    return {
        'intent': 'ads_campaign',
        'summary': f'Generate RSA headlines and descriptions for "{name}".',
        'assistant_message': 'Assets will be saved on the campaign draft.',
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': [],
    }


def _optimize_campaign_workflow(ctx: dict[str, Any], campaign_id: str | None) -> dict[str, Any]:
    if not campaign_id:
        return {
            'intent': 'informational',
            'summary': 'Campaign id required for optimization.',
            'assistant_message': 'Provide a campaign id from your campaigns list.',
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
        }
    payload = {
        'workspace_id': ctx.get('workspace_id'),
        'campaign_id': campaign_id,
    }
    steps = [{
        'step_id': 'step_1',
        'tool_id': 'optimize_campaign',
        'payload': payload,
        'depends_on': [],
    }]
    return {
        'intent': 'ads_campaign',
        'summary': 'Analyze campaign KPIs and produce optimization suggestions.',
        'assistant_message': 'Suggestions use the same pacing and bid logic as the Budget panel.',
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': [],
    }


def build_fallback_ads_workflow(user_message: str, ctx: dict[str, Any]) -> dict[str, Any]:
    """Deprecated alias — use route_ads_workflow."""
    return route_ads_workflow(user_message, ctx)


def route_ads_workflow(user_message: str, ctx: dict[str, Any]) -> dict[str, Any]:
    workspace_id = ctx.get('workspace_id')
    history = ctx.get('conversation_history') or []
    if not ctx.get('planner_trace'):
        ctx['planner_trace'] = PlannerTrace()
    session = resolve_ads_session(history)
    intent = workflow_intent_from_ctx(ctx)
    if not intent and session.pinned_intent:
        intent = session.pinned_intent
        ctx['workflow_intent'] = intent.workflow_id
        ctx['workflow_intent_confidence'] = intent.confidence
    if not intent:
        trace = ctx.get('planner_trace')
        if trace is not None:
            trace.log_llm('Classify ads intent', feature='Planner', source='workflow_intent_classifier')
        intent = classify_workflow_intent_with_planner(
            workspace_id=str(workspace_id) if workspace_id else None,
            message=user_message,
            conversation_history=history,
        )
    platform_override = resolve_ads_platform_from_intent(intent, user_message, ctx)
    platform = platform_override or (session.platform if session.platform != 'unknown' else None)
    platform = platform or detect_ads_platform(user_message, ctx)
    mode = resolve_ads_mode_from_intent(intent) or detect_ads_mode(user_message)
    account_id = _pick_ads_account_id(platform, ctx)
    if account_id and platform == 'unknown':
        platform = _infer_platform_for_account(ctx, account_id)
    prompt = user_message.strip()
    campaign_id = _extract_campaign_id(prompt)

    budget_modes = (
        'budget_pacing',
        'budget_reallocation',
        'bid_optimization',
        'quality_score',
        'asset_ab',
        'generate_assets',
    )
    if mode in budget_modes:
        if mode == 'budget_pacing':
            return _budget_pacing_workflow(ctx, prompt)
        if mode == 'budget_reallocation':
            return _budget_reallocation_workflow(ctx, prompt)
        if mode == 'bid_optimization':
            return _bid_optimization_workflow(ctx, prompt, campaign_id)
        if mode == 'quality_score':
            return _quality_score_workflow(ctx, prompt, campaign_id)
        if mode == 'asset_ab':
            return _asset_ab_workflow(ctx, prompt, campaign_id)
        if mode == 'generate_assets':
            return _generate_assets_workflow(ctx, prompt, campaign_id, _extract_campaign_name(prompt))

    if not account_id or platform == 'unknown':
        err = _ads_account_resolution_error(ctx, platform)
        err_msg = render_agent_message(
            workspace_id=str(workspace_id) if workspace_id else None,
            phase='error',
            workflow_label='Ads workflow',
            error=err,
        )
        return {
            'intent': 'informational',
            'summary': err,
            'assistant_message': err_msg,
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
        }

    base_payload: dict[str, Any] = {
        'account_id': account_id,
        'workspace_id': ctx.get('workspace_id'),
    }

    if platform == 'google_ads' and mode == 'optimize':
        if campaign_id and re.search(r'\b(optimize campaign|campaign optim)\b', prompt, re.I):
            return _optimize_campaign_workflow(ctx, campaign_id)
        return _google_optimize_workflow(base_payload, prompt, campaign_id)

    if platform == 'google_ads' and mode == 'audience':
        return _google_audience_workflow(base_payload, prompt)

    if platform == 'google_ads' and mode == 'schedule':
        camp_payload = {**base_payload}
        if campaign_id:
            camp_payload['platform_campaign_id'] = campaign_id
        steps = [
            {'step_id': 'step_1', 'tool_id': 'google_get_account', 'payload': dict(base_payload), 'depends_on': []},
            {
                'step_id': 'step_2',
                'tool_id': 'google_create_ad_schedule',
                'payload': {
                    **camp_payload,
                    'schedules': [
                        {'day_of_week': 'MONDAY', 'start_hour': 9, 'end_hour': 17, 'bid_modifier': 1.0},
                        {'day_of_week': 'TUESDAY', 'start_hour': 9, 'end_hour': 17, 'bid_modifier': 1.0},
                    ],
                },
                'depends_on': ['step_1'],
                'requires_approval': True,
            },
        ]
        return {
            'intent': 'ads_campaign',
            'summary': 'Set ad schedule (dayparting) on campaign.',
            'assistant_message': (
                'Edit schedules in step 2 (days, hours, bid_modifier). '
                + ('' if campaign_id else 'Add campaign id to your message for the correct campaign.')
            ),
            'steps': steps,
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': ['step_2'],
        }

    if mode == 'report':
        if platform == 'google_ads':
            steps = [
                {
                    'step_id': 'step_1',
                    'tool_id': 'google_report_account_summary',
                    'payload': {**base_payload, 'date_range': 'LAST_30_DAYS'},
                    'depends_on': [],
                },
                {
                    'step_id': 'step_2',
                    'tool_id': 'google_report_optimization_hints',
                    'payload': {**base_payload, 'date_range': 'LAST_30_DAYS'},
                    'depends_on': ['step_1'],
                },
            ]
            if campaign_id:
                steps.append({
                    'step_id': 'step_3',
                    'tool_id': 'google_report_performance',
                    'payload': {
                        **base_payload,
                        'platform_campaign_id': campaign_id,
                        'date_range': 'LAST_30_DAYS',
                    },
                    'depends_on': ['step_2'],
                })
            return {
                'intent': 'analytics',
                'summary': 'Google account health: summary → optimization hints' + (
                    ' → campaign performance' if campaign_id else ''
                ),
                'assistant_message': 'Read-only reporting chain; I will not auto-apply bid or geo changes.',
                'steps': steps,
                'dependencies': [],
                'parallel_groups': [],
                'approval_gates': [],
            }
        tool_id = 'meta_report_insights'
        base_payload['level'] = 'account'
        base_payload['date_preset'] = 'last_30d'
        return {
            'intent': 'analytics',
            'summary': 'Fetch Meta Ads account insights for the last 30 days.',
            'assistant_message': 'Fetch Meta Ads account insights for the last 30 days.',
            'steps': [{
                'step_id': 'step_1',
                'tool_id': tool_id,
                'payload': base_payload,
                'depends_on': [],
            }],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
        }

    if mode == 'list':
        tool_id = 'google_list_campaigns' if platform == 'google_ads' else 'meta_list_campaigns'
        label = 'Google' if platform == 'google_ads' else 'Meta'
        return {
            'intent': 'analytics',
            'summary': f'List {label} campaigns on the connected account.',
            'assistant_message': f'I will list your {label} campaigns using the read-only list tool.',
            'steps': [{
                'step_id': 'step_1',
                'tool_id': tool_id,
                'payload': base_payload,
                'depends_on': [],
            }],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
        }

    if mode == 'pause':
        if platform == 'meta_ads' and campaign_id:
            steps = [
                {
                    'step_id': 'step_1',
                    'tool_id': 'meta_list_campaigns',
                    'payload': dict(base_payload),
                    'depends_on': [],
                },
                {
                    'step_id': 'step_2',
                    'tool_id': 'meta_update_campaign',
                    'payload': {
                        **base_payload,
                        'campaign_id': campaign_id,
                        'status': 'PAUSED',
                    },
                    'depends_on': ['step_1'],
                    'requires_approval': True,
                },
            ]
            return {
                'intent': 'ads_campaign',
                'summary': f'Pause Meta campaign {campaign_id} (list → update).',
                'assistant_message': (
                    f'I will list campaigns to re-validate, then pause campaign {campaign_id}. '
                    'Confirm the id matches your target before approving.'
                ),
                'steps': steps,
                'dependencies': [],
                'parallel_groups': [],
                'approval_gates': ['step_2'],
            }
        return {
            'intent': 'informational',
            'summary': 'Specify which campaign to pause (name or id).',
            'assistant_message': (
                'To pause a campaign, tell me the platform and campaign id. '
                'I will use google_pause_campaign or meta_update_campaign (paused).'
            ),
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
        }

    # create / publish — campaign name is inferred in compile (LLM-first, like geo intent).
    if platform == 'google_ads':
        from lib.planner.google_campaign_llm import resolve_google_campaign_name
        from lib.planner.google_campaign_spec import plan_google_create_workflow

        name = resolve_google_campaign_name(prompt=prompt)
        granular = any(k in prompt.lower() for k in ('step by step', 'step-by-step', 'granular', 'one at a time'))
        if granular:
            steps = _google_granular_create_steps(base_payload, name, prompt=prompt, ctx=ctx)
            return {
                'intent': 'ads_campaign',
                'summary': f'Build Google Search campaign "{name}" step-by-step (budget → RSA).',
                'assistant_message': (
                    f'Granular chain for "{name}". Each step passes platform_campaign_id / '
                    'platform_ad_set_id to the next — edit payloads before approving write steps.'
                ),
                'steps': steps,
                'dependencies': [],
                'parallel_groups': [],
                'approval_gates': ['step_3', 'step_6'],
            }

        return plan_google_create_workflow(
            prompt=prompt,
            ctx=ctx,
            base_payload=base_payload,
            name='',  # resolved inside compile_google_campaign (LLM-first)
        )

    name = _extract_campaign_name(prompt)
    create_mode = _meta_create_mode(prompt, has_image=_has_image_source(ctx, prompt))

    if create_mode == 'strategy':
        steps = _meta_strategy_steps(base_payload, prompt, ctx=ctx)
        return {
            'intent': 'analytics',
            'summary': f'Meta audience research for "{name}" (read-only).',
            'assistant_message': (
                'Research-only workflow: geo + interests + audience size. '
                'No campaigns will be created. Say "create a draft campaign" when ready to write to Meta.'
            ),
            'steps': steps,
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
        }

    return plan_meta_create_workflow(
        prompt=prompt,
        ctx=ctx,
        base_payload=base_payload,
        name=name,
    )
