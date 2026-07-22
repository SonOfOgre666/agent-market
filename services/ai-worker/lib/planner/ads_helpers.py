"""Ads helpers for planner context (merge follow-ups, detect platform).

Does NOT build hardcoded campaign workflows — those were removed.
The agent planner LLM plans Meta/Google graphs from prompts + tool catalog.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from lib.planner.ads_session import (
    is_ads_collection_active,
    is_assistant_collecting_ads_fields,
    merge_ads_conversation_user_messages,
)
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
    """User is replying while an ads collection workflow is active (graph metadata)."""
    current = (user_message or '').strip()
    if not current:
        return False
    history = list(conversation_history or [])
    if not history:
        return False

    from lib.planner.meta_campaign_spec import is_meta_campaign_approval
    from lib.planner.google_campaign_spec import is_google_campaign_approval

    if is_meta_campaign_approval(current, history):
        return True
    if is_google_campaign_approval(current, history):
        return True
    return is_ads_collection_active(history)


def resolve_ads_planning_message(
    user_message: str,
    conversation_history: list[dict[str, Any]] | None,
) -> str:
    """
    Merge user turns during active ads collection / approval.

    Detection is graph/session metadata first (collection_phase, setup phases).
    Conversation history is also passed separately to the planner LLM.
    """
    current = (user_message or '').strip()
    history = list(conversation_history or [])

    if is_ads_clarification_followup(current, history):
        return merge_ads_conversation_user_messages(current, history)

    return current


