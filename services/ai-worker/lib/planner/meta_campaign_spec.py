"""
Meta Ads campaign creation — SPEC_META_ADS_AI_AGENT.md (CBO, phase 1).

Collection → review → explicit approval → campaign → adset → upload → creative → ad.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from lib.planner.agent_dialogue import compiled_meta_facts, enrich_facts_for_dialogue, render_agent_message
from lib.planner.workflow_collect import compute_meta_missing
from lib.planner.meta_campaign_llm import resolve_meta_ad_copy
from lib.planner.meta_page_selection import (
    fetch_usable_pages,
    format_pages_for_user,
    is_meta_acceptable_destination_url,
    pages_from_assistant_message,
    resolve_page_ids,
    resolve_page_ids_from_conversation,
    usable_pages,
)
from lib.planner.geo_targeting_intent import (
    GeoTargetingIntent,
    extract_geo_targeting_intent,
    merge_geo_intent_with_llm_countries,
)

BranchId = Literal[
    'single_image',
    'single_video',
    'instant_form_image',
    'leads_website_image',
    'app_image',
    'app_video',
]

EU_ISO = frozenset({
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
    'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
})

_COUNTRY_ALIASES: dict[str, str] = {
    'morocco': 'MA',
    'maroc': 'MA',
    'algeria': 'DZ',
    'tunisia': 'TN',
    'france': 'FR',
    'spain': 'ES',
    'germany': 'DE',
    'italy': 'IT',
    'united kingdom': 'GB',
    'uk': 'GB',
    'canada': 'CA',
    'united states': 'US',
    'usa': 'US',
    'u.s.': 'US',
    'u.s.a.': 'US',
    'netherlands': 'NL',
    'belgium': 'BE',
    'portugal': 'PT',
    'turkey': 'TR',
    'türkiye': 'TR',
    'saudi arabia': 'SA',
    'uae': 'AE',
    'united arab emirates': 'AE',
    'egypt': 'EG',
    'mexico': 'MX',
    'brazil': 'BR',
    'india': 'IN',
    'australia': 'AU',
}

_ISO_RE = re.compile(r'\b([A-Z]{2})\b')
_BUDGET_RES = (
    re.compile(r'\$(\d+(?:\.\d+)?)\s*/?\s*day\b', re.I),
    re.compile(r'(\d+(?:\.\d+)?)\s*(?:usd|dollars?)\s*(?:/|per)\s*day\b', re.I),
    re.compile(r'budget\s*(?:of|:)?\s*\$?(\d+(?:\.\d+)?)\s*(?:/|per)?\s*day\b', re.I),
    re.compile(r'(\d+(?:\.\d+)?)\s*/\s*day\b', re.I),
    re.compile(r'^\s*\$(\d+(?:\.\d+)?)\s*$', re.I),
    re.compile(r'^\s*(\d+(?:\.\d+)?)\s*\$\s*$', re.I),
    re.compile(r'\$(\d+(?:\.\d+)?)\b', re.I),
    re.compile(r'(\d+(?:\.\d+)?)\s*\$', re.I),
)
_END_DATE_RES = (
    re.compile(r'\b(20\d{2})-(\d{2})-(\d{2})\b'),
    re.compile(
        r'\b(?:until|through|ends?|end date)\s+'
        r'(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|'
        r'jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
        r'\s+(\d{1,2})(?:,?\s*(20\d{2}))?\b',
        re.I,
    ),
)
_MONTH = {
    'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
    'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
    'aug': 8, 'august': 8, 'sep': 9, 'september': 9, 'oct': 10, 'october': 10,
    'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
}
_IMAGE_URL_SUFFIX_RE = re.compile(r'\.(jpg|jpeg|png|gif|webp)(\?|$)', re.I)
_APPROVE_RE = re.compile(r'\b(APPROVE|yes, create it|create campaign)\b', re.I)
_REVIEW_MARKERS = ('Campaign Review', 'Approve and spend up to', 'Type APPROVE to continue')


@dataclass
class MetaCampaignCompiled:
    name: str
    objective: str
    branch: str
    budget_amount: float
    end_time: str
    geo_countries: list[str]
    page_ids: list[str]
    page_names: list[str]
    geo_intent: GeoTargetingIntent | None = None
    needs_geo_resolve: bool = False
    link_url: str | None = None
    lead_gen_form_id: str | None = None
    application_id: str | None = None
    object_store_url: str | None = None
    pixel_id: str | None = None
    media_id: str | None = None
    image_url: str | None = None
    video_url: str | None = None
    message: str = ''
    headline: str = ''
    description: str = ''
    copy_generated: bool = False
    dsa_beneficiary: str | None = None
    dsa_payor: str | None = None
    currency: str = 'USD'
    status: str = 'PAUSED'
    estimated_max_spend: float = 0.0
    day_count: int = 0
    objective_inferred: bool = False
    start_time: str | None = None


ObjectiveSource = Literal['explicit', 'inferred', 'unclear']

_VALID_OBJECTIVES = frozenset({
    'OUTCOME_TRAFFIC',
    'OUTCOME_AWARENESS',
    'OUTCOME_ENGAGEMENT',
    'OUTCOME_LEADS',
    'OUTCOME_SALES',
    'OUTCOME_APP_PROMOTION',
})


def primary_image_attachment(ctx: dict[str, Any]) -> dict[str, Any] | None:
    for row in ctx.get('attached_media') or []:
        mime = str(row.get('mime_type') or '')
        if mime.startswith('image/') and row.get('id'):
            return row
    return None


def primary_video_attachment(ctx: dict[str, Any]) -> dict[str, Any] | None:
    for row in ctx.get('attached_media') or []:
        mime = str(row.get('mime_type') or '')
        if mime.startswith('video/') and row.get('id'):
            return row
    return None


def public_image_url_from_prompt(prompt: str) -> str | None:
    for raw in re.findall(r'https?://[^\s<>"\']+', prompt or ''):
        url = raw.rstrip('.,)')
        if _IMAGE_URL_SUFFIX_RE.search(url):
            return url
    return None


def extract_destination_url(prompt: str) -> str | None:
    for raw in re.findall(r'https?://[^\s<>"\']+', prompt or ''):
        url = raw.rstrip('.,)')
        if _IMAGE_URL_SUFFIX_RE.search(url):
            continue
        if 'play.google.com' in url or 'apps.apple.com' in url:
            continue
        return url
    return None


def full_conversation_text(
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
) -> str:
    """All user turns merged — used for field extraction across multi-turn collection."""
    parts: list[str] = []
    for msg in conversation_history or []:
        if msg.get('role') != 'user':
            continue
        text = str(msg.get('content') or '').strip()
        if text:
            parts.append(text)
    current = (prompt or '').strip()
    if current and (not parts or parts[-1] != current):
        parts.append(current)
    return '\n\n'.join(parts)


def build_collected_acknowledgment(collected: dict[str, Any]) -> str:
    """Rule-based friendly summary when the agent model did not return one."""
    bits: list[str] = []
    if collected.get('page_names'):
        bits.append(f"Page **{', '.join(collected['page_names'])}**")
    obj = collected.get('objective')
    if obj:
        bits.append(f"**{str(obj).replace('OUTCOME_', '').title()}** objective")
    if collected.get('budget') is not None:
        bits.append(f"**${float(collected['budget']):.0f}/day**")
    if collected.get('start_time'):
        bits.append(f"starts **{str(collected['start_time'])[:10]}**")
    if collected.get('end_time'):
        bits.append(f"ends **{str(collected['end_time'])[:10]}**")
    if collected.get('geo'):
        bits.append(f"targeting **{', '.join(collected['geo'])}**")
    if collected.get('format_hint'):
        bits.append(f"**{collected['format_hint']}** creative")
    if collected.get('link_url'):
        bits.append(f"shop URL set")
    if not bits:
        return ''
    return 'Got it — ' + ', '.join(bits) + '.'


_OBJECTIVE_OUTCOME_RE = re.compile(
    r'\bOUTCOME_(TRAFFIC|AWARENESS|ENGAGEMENT|LEADS|SALES|APP_PROMOTION)\b',
    re.I,
)

_OBJECTIVE_KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (('sales', 'conversion', 'purchase', 'roas', 'purchases'), 'OUTCOME_SALES'),
    (('lead', 'leads'), 'OUTCOME_LEADS'),
    (('awareness', 'reach', 'brand awareness'), 'OUTCOME_AWARENESS'),
    (('engagement', 'post engagement'), 'OUTCOME_ENGAGEMENT'),
    (('app install', 'app promotion', 'app installs'), 'OUTCOME_APP_PROMOTION'),
    (
        ('traffic', 'link click', 'link clicks', 'website traffic', 'drive traffic'),
        'OUTCOME_TRAFFIC',
    ),
)

_OBJECTIVE_STANDALONE: dict[str, str] = {
    'traffic': 'OUTCOME_TRAFFIC',
    'awareness': 'OUTCOME_AWARENESS',
    'engagement': 'OUTCOME_ENGAGEMENT',
    'leads': 'OUTCOME_LEADS',
    'sales': 'OUTCOME_SALES',
    'app promotion': 'OUTCOME_APP_PROMOTION',
    'app installs': 'OUTCOME_APP_PROMOTION',
}


def meta_objective_from_prompt(prompt: str) -> str | None:
    """Infer ODAX objective from explicit signals only — never default."""
    text = prompt or ''
    hit = _OBJECTIVE_OUTCOME_RE.search(text)
    if hit:
        return f'OUTCOME_{hit.group(1).upper()}'

    lower = text.lower()
    for keywords, objective in _OBJECTIVE_KEYWORDS:
        if any(k in lower for k in keywords):
            return objective

    stripped = re.sub(r'\s+', ' ', lower.strip().rstrip('.!'))
    if stripped in _OBJECTIVE_STANDALONE:
        return _OBJECTIVE_STANDALONE[stripped]

    return None


_HEURISTIC_SIGNALS: dict[str, tuple[str, ...]] = {
    'OUTCOME_AWARENESS': (
        'promote my brand', 'brand visibility', 'get seen', 'people know about',
        'raise awareness', 'introduce my', 'tell people about', 'make people aware',
        'brand recognition', 'get the word out',
    ),
    'OUTCOME_TRAFFIC': (
        'website visitors', 'drive to my site', 'visit my website', 'visit my shop',
        'send people to', 'get people to my', 'more visitors', 'drive traffic',
        'landing page traffic', 'shop online', 'click through to', 'drive clicks',
    ),
    'OUTCOME_ENGAGEMENT': (
        'page likes', 'boost my page', 'post engagement', 'engage with my',
        'grow my page', 'comments and shares', 'interact with', 'boost engagement',
        'more likes', 'page growth',
    ),
    'OUTCOME_LEADS': (
        'collect leads', 'lead generation', 'sign up form', 'contact details',
        'quote request', 'book a call', 'get leads', 'capture leads',
    ),
    'OUTCOME_SALES': (
        'sell more', 'online sales', 'drive purchases', 'increase sales',
        'checkout', 'buy now', 'e-commerce sales', 'product sales', 'people to buy',
        'drive conversions', 'more orders',
    ),
    'OUTCOME_APP_PROMOTION': (
        'download the app', 'install the app', 'app downloads', 'get installs',
        'play store', 'app store listing', 'mobile app install',
    ),
}

_META_CAMPAIGN_INTENT_MARKERS = (
    'meta ad', 'meta ads', 'facebook ad', 'facebook ads', 'instagram ad',
    'instagram ads', 'fb ad', 'fb ads', 'create campaign', 'run ads', 'ad campaign',
)


def _infer_meta_objective_heuristic(prompt: str) -> str | None:
    """Score intent phrases; return objective only when one signal clearly wins."""
    lower = (prompt or '').lower()
    scores = {obj: sum(1 for sig in signals if sig in lower) for obj, signals in _HEURISTIC_SIGNALS.items()}
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    if not ranked or ranked[0][1] == 0:
        return None
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return None
    return ranked[0][0]


def _looks_like_meta_campaign_intent(prompt: str) -> bool:
    lower = (prompt or '').lower()
    if any(marker in lower for marker in _META_CAMPAIGN_INTENT_MARKERS):
        return True
    return bool(extract_daily_budget(prompt) and resolve_geo_countries(prompt))


def _infer_meta_objective_llm(prompt: str, workspace_id: str | None) -> str | None:
    """Optional LLM classification when rules/heuristics are inconclusive."""
    try:
        from lib.ai_workspace_config import get_planner_config
        from lib.llm import text as text_llm
        from lib.llm.json_utils import parse_json_text

        cfg = get_planner_config(workspace_id)
        llm_prompt = f"""Classify the Meta Ads ODAX campaign objective for this user message.

Valid objectives (return exactly one of these strings, or null):
- OUTCOME_TRAFFIC — drive website visits / link clicks
- OUTCOME_AWARENESS — brand reach and visibility
- OUTCOME_ENGAGEMENT — post / Page engagement
- OUTCOME_LEADS — lead forms or website leads
- OUTCOME_SALES — purchases / conversions (needs pixel)
- OUTCOME_APP_PROMOTION — app installs

Return JSON only:
{{"objective": "OUTCOME_..." | null, "confidence": "high" | "low", "reason": "brief"}}

Rules:
- confidence "high" only when one objective clearly fits the user's goal
- use null + confidence "low" for generic requests like "create meta ads" with no goal
- never default to traffic when unsure

User message:
{prompt.strip()}"""
        raw = text_llm.complete(
            cfg['provider'],
            cfg['model'],
            llm_prompt,
            workspace_id=workspace_id,
            temperature=0.1,
            max_tokens=200,
            api_model_id=cfg.get('api_model_id'),
            opcode='plan_workflow',
            source='meta_objective_classifier',
            record_usage=True,
        )
        parsed = parse_json_text(raw, {})
        if not isinstance(parsed, dict):
            return None
        if str(parsed.get('confidence') or '').lower() != 'high':
            return None
        objective = str(parsed.get('objective') or '').strip().upper()
        if objective in _VALID_OBJECTIVES:
            return objective
    except Exception:
        return None
    return None


def resolve_meta_objective(
    prompt: str,
    *,
    workspace_id: str | None = None,
) -> tuple[str | None, ObjectiveSource]:
    """
    Resolve campaign objective in three tiers:
    1. Explicit keywords / ODAX labels from the user
    2. Inferred intent (structural cues, heuristics, optional LLM)
    3. Unclear — caller should ask the user
    """
    explicit = meta_objective_from_prompt(prompt)
    if explicit:
        return explicit, 'explicit'

    lower = (prompt or '').lower()
    if extract_lead_form_id(prompt) or any(
        k in lower for k in ('instant form', 'lead form', 'meta form', 'on-ad form')
    ):
        return 'OUTCOME_LEADS', 'inferred'

    app_id, store_url = extract_app_ids(prompt)
    if app_id or store_url or 'play.google.com' in lower or 'apps.apple.com' in lower:
        return 'OUTCOME_APP_PROMOTION', 'inferred'

    heuristic = _infer_meta_objective_heuristic(prompt)
    if heuristic:
        return heuristic, 'inferred'

    if _looks_like_meta_campaign_intent(prompt):
        llm_objective = _infer_meta_objective_llm(prompt, workspace_id)
        if llm_objective:
            return llm_objective, 'inferred'

    return None, 'unclear'


def extract_daily_budget(prompt: str) -> float | None:
    for pat in _BUDGET_RES:
        hit = pat.search(prompt or '')
        if hit:
            amount = float(hit.group(1))
            if amount >= 1:
                return amount
    return None


def _normalize_date_typos(text: str) -> str:
    return (
        text.replace('tomorow', 'tomorrow')
        .replace('tommorrow', 'tomorrow')
        .replace('tommorow', 'tomorrow')
    )


def _start_of_day_iso(y: int, mo: int, d: int) -> str:
    return datetime(y, mo, d, 0, 0, 0, tzinfo=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+0000')


def extract_schedule_times(prompt: str) -> tuple[str | None, str | None]:
    """
    Parse natural-language start/end schedule from the full conversation text.
    Returns (start_time_iso, end_time_iso) — end is always end-of-day UTC.
    """
    text = _normalize_date_typos((prompt or '').lower())
    now = datetime.now(timezone.utc)
    start_time: str | None = None
    end_time: str | None = None

    iso = _END_DATE_RES[0].search(prompt or '')
    if iso:
        y, mo, d = int(iso.group(1)), int(iso.group(2)), int(iso.group(3))
        end_time = _end_of_day_iso(y, mo, d)

    named = _END_DATE_RES[1].search(prompt or '')
    if named and not end_time:
        year = int(named.group(3)) if named.group(3) else now.year
        month_key = named.group(1).lower()
        month = _MONTH.get(month_key, 0)
        day = int(named.group(2))
        if month and day:
            dt = datetime(year, month, day, 23, 59, 59, tzinfo=timezone.utc)
            if dt <= now:
                dt = dt.replace(year=year + 1)
            end_time = dt.strftime('%Y-%m-%dT%H:%M:%S+0000')

    has_start_kw = bool(re.search(r'\b(?:start|starts|starting|begin|begins)\b', text))
    has_end_kw = bool(re.search(r'\b(?:end|ends|ending|until|through|till|stop)\b', text))

    if has_start_kw and re.search(r'\btomorrow\b', text):
        d = now + timedelta(days=1)
        start_time = _start_of_day_iso(d.year, d.month, d.day)
    elif has_start_kw and re.search(r'\btoday\b', text):
        start_time = _start_of_day_iso(now.year, now.month, now.day)

    if re.search(r'\b(?:end|ends|ending|until|through|till|stop)\b.*\bnext\s+week\b', text) or re.search(
        r'\bend\s+on\s+next\s+week\b', text,
    ):
        anchor = now
        if start_time:
            anchor = datetime.fromisoformat(start_time.replace('+0000', '+00:00'))
        end_d = anchor + timedelta(days=7)
        end_time = _end_of_day_iso(end_d.year, end_d.month, end_d.day)
    elif has_end_kw and re.search(r'\btomorrow\b', text):
        d = now + timedelta(days=1)
        end_time = _end_of_day_iso(d.year, d.month, d.day)
    elif re.search(r'\bnext\s+week\b', text) and not end_time:
        end_d = now + timedelta(days=7)
        end_time = _end_of_day_iso(end_d.year, end_d.month, end_d.day)
    elif re.search(r'\btomorrow\b', text) and not has_start_kw and not end_time:
        d = now + timedelta(days=1)
        end_time = _end_of_day_iso(d.year, d.month, d.day)
    elif re.search(r'\btoday\b', text) and not has_start_kw and not end_time:
        end_time = _end_of_day_iso(now.year, now.month, now.day)

    if not end_time:
        rel = re.search(
            r'\b(?:end(?:s|ing)?\s+)?(?:after|in|for)\s+(\d{1,3})\s+days?\b',
            text,
        )
        if rel:
            days = int(rel.group(1))
            if days >= 1:
                anchor = now
                if start_time:
                    anchor = datetime.fromisoformat(start_time.replace('+0000', '+00:00'))
                end_d = anchor + timedelta(days=days)
                end_time = _end_of_day_iso(end_d.year, end_d.month, end_d.day)

    return start_time, end_time


def extract_end_time_iso(prompt: str) -> str | None:
    _, end_time = extract_schedule_times(prompt)
    return end_time


def extract_start_time_iso(prompt: str) -> str | None:
    start_time, _ = extract_schedule_times(prompt)
    return start_time


def _end_of_day_iso(y: int, mo: int, d: int) -> str:
    return datetime(y, mo, d, 23, 59, 59, tzinfo=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+0000')


def resolve_geo_countries(prompt: str, base_payload: dict[str, Any] | None = None) -> list[str] | None:
    """Return ISO list when resolved; None when country not mentioned (never default US)."""
    from lib.google_geo_targets import GOOGLE_GEO_BY_ISO

    m = (prompt or '').lower()
    found: list[str] = []
    for alias, iso in _COUNTRY_ALIASES.items():
        if alias in m and iso not in found:
            found.append(iso)
    for hit in _ISO_RE.finditer(prompt or ''):
        iso = hit.group(1)
        if iso in GOOGLE_GEO_BY_ISO and iso not in found:
            found.append(iso)
    if found:
        return found

    if not base_payload:
        return None

    query = _extract_country_search_query(prompt)
    if not query:
        return None

    try:
        from tools.ads._resolve import enrich_ads_tool_payload
        from tools.ads.registry import run_ads_tool

        out = run_ads_tool(
            'meta_search_geo_locations',
            enrich_ads_tool_payload(
                'meta_search_geo_locations',
                {
                    **base_payload,
                    'query': query,
                    'location_types': ['country'],
                },
            ),
        )
        if not out.get('ok'):
            return None
        rows = out.get('data') or []
        codes: list[str] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            code = str(row.get('country_code') or row.get('key') or '').strip().upper()
            if len(code) == 2 and code not in codes:
                codes.append(code)
        if len(codes) == 1:
            return codes
    except Exception:
        return None
    return None


def _extract_country_search_query(prompt: str) -> str | None:
    m = (prompt or '').lower()
    for alias in sorted(_COUNTRY_ALIASES.keys(), key=len, reverse=True):
        if alias in m:
            return alias.title()
    hit = re.search(
        r'\b(?:in|for|target(?:ing)?|country|geo)\s+([a-z][a-z\s\-]{2,40})',
        m,
    )
    if hit:
        return hit.group(1).strip().title()
    return None


def _media_kind(ctx: dict[str, Any], prompt: str) -> Literal['image', 'video', 'none']:
    if primary_video_attachment(ctx):
        return 'video'
    if primary_image_attachment(ctx) or public_image_url_from_prompt(prompt):
        return 'image'
    if re.search(r'\bvideo\b|\bvideo ad\b|\breel\b', (prompt or '').lower()):
        return 'video'
    if re.search(r'\bimage ad\b|\bphoto ad\b|\bimage\b', (prompt or '').lower()):
        return 'image'
    return 'none'


def _leads_destination(prompt: str) -> Literal['website', 'instant_form'] | None:
    m = (prompt or '').lower()
    if any(k in m for k in ('instant form', 'lead form', 'meta form', 'on-ad form', 'instant form leads')):
        return 'instant_form'
    if any(k in m for k in (
        'website lead', 'website leads', 'landing page lead', 'site lead',
        'website', 'landing page', 'landing',
    )):
        return 'website'
    if re.search(r'\bform id\s+\d+', m):
        return 'instant_form'
    if extract_destination_url(prompt):
        return 'website'
    return None


def resolve_branch(objective: str, ctx: dict[str, Any], prompt: str) -> tuple[str | None, bool]:
    """
    Return (branch_id, image_video_ambiguous).
    branch_id None when destination/format still unknown.
    """
    media = _media_kind(ctx, prompt)

    if objective == 'OUTCOME_SALES':
        return 'single_image', False

    if objective == 'OUTCOME_LEADS':
        dest = _leads_destination(prompt)
        if dest == 'instant_form':
            return 'instant_form_image', False
        if dest == 'website':
            return 'leads_website_image', False
        return None, False

    if objective == 'OUTCOME_APP_PROMOTION':
        if media == 'video':
            return 'app_video', False
        if media == 'image':
            return 'app_image', False
        if re.search(r'\bvideo\b', (prompt or '').lower()):
            return 'app_video', False
        if re.search(r'\bimage\b', (prompt or '').lower()):
            return 'app_image', False
        return None, True

    # Traffic, Awareness, Engagement — image or video
    if media == 'video':
        return 'single_video', False
    if media == 'image':
        return 'single_image', False
    return None, True


def resolve_branch_with_format(
    objective: str,
    ctx: dict[str, Any],
    prompt: str,
    *,
    format_hint: Literal['image', 'video'] | None = None,
) -> tuple[str | None, bool]:
    """Resolve creative branch; optional format hint from planner LLM or user."""
    branch, amb = resolve_branch(objective, ctx, prompt)
    if not format_hint:
        return branch, amb
    if branch and not amb:
        return branch, amb

    if objective == 'OUTCOME_SALES':
        return 'single_image', False
    if objective == 'OUTCOME_LEADS':
        dest = _leads_destination(prompt)
        if dest == 'instant_form':
            return 'instant_form_image', False
        return 'leads_website_image', False
    if objective == 'OUTCOME_APP_PROMOTION':
        return ('app_video' if format_hint == 'video' else 'app_image'), False
    return ('single_video' if format_hint == 'video' else 'single_image'), False


def branch_is_image(branch: str | None) -> bool:
    return branch in {
        'single_image', 'instant_form_image', 'leads_website_image', 'app_image',
    }


def branch_is_video(branch: str | None) -> bool:
    return branch in {'single_video', 'app_video'}


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


def extract_lead_form_id(prompt: str) -> str | None:
    hit = re.search(r'\b(?:form id|lead form|instant form)\s*[#:]?\s*(\d{6,})\b', prompt or '', re.I)
    return hit.group(1) if hit else None


def extract_app_ids(prompt: str) -> tuple[str | None, str | None]:
    app_id = None
    hit = re.search(r'\b(?:app id|application id)\s*[#:]?\s*(\d{6,})\b', prompt or '', re.I)
    if hit:
        app_id = hit.group(1)
    store_url = None
    for raw in re.findall(r'https?://[^\s<>"\']+', prompt or ''):
        url = raw.rstrip('.,)')
        if 'play.google.com' in url or 'apps.apple.com' in url:
            store_url = url
            break
    return app_id, store_url


def _user_provided_copy(prompt: str) -> tuple[str | None, str | None, str | None]:
    """Extract verbatim copy blocks if user labeled them."""
    message = headline = description = None
    for line in (prompt or '').splitlines():
        low = line.lower().strip()
        if low.startswith('message:') or low.startswith('primary text:'):
            message = line.split(':', 1)[1].strip()
        elif low.startswith('headline:'):
            headline = line.split(':', 1)[1].strip()
        elif low.startswith('description:'):
            description = line.split(':', 1)[1].strip()
    quoted = re.findall(r'["\']([^"\']{8,200})["\']', prompt or '')
    if quoted and not message:
        message = quoted[0]
    return message, headline, description


def generate_copy(
    name: str,
    objective: str,
    prompt: str,
    *,
    conversation_history: list[dict[str, Any]] | None = None,
    workspace_id: str | None = None,
    link_url: str | None = None,
) -> tuple[str, str, str]:
    message, headline, description, _source = resolve_meta_ad_copy(
        campaign_name=name,
        objective=objective,
        prompt=prompt,
        conversation_history=conversation_history,
        workspace_id=workspace_id,
        link_url=link_url,
    )
    return message, headline, description


def resolve_creative_copy(
    name: str,
    objective: str,
    prompt: str,
    *,
    conversation_history: list[dict[str, Any]] | None = None,
    workspace_id: str | None = None,
    link_url: str | None = None,
) -> tuple[str, str, str, bool]:
    um, uh, ud = _user_provided_copy(prompt)
    generated = False
    if um or uh or ud:
        gm, gh, gd = generate_copy(
            name,
            objective,
            prompt,
            conversation_history=conversation_history,
            workspace_id=workspace_id,
            link_url=link_url,
        )
        message = um or gm
        headline = uh or gh
        description = ud or (gd if not um else '')
        generated = not (um and uh)
    else:
        message, headline, description = generate_copy(
            name,
            objective,
            prompt,
            conversation_history=conversation_history,
            workspace_id=workspace_id,
            link_url=link_url,
        )
        generated = True
    if not description and generated:
        _, _, description = generate_copy(
            name,
            objective,
            prompt,
            conversation_history=conversation_history,
            workspace_id=workspace_id,
            link_url=link_url,
        )
    return message, headline, description, generated


def cta_for_branch(branch: str | None) -> str | None:
    if branch == 'instant_form_image':
        return 'SIGN_UP'
    if branch in ('app_image', 'app_video'):
        return 'INSTALL_MOBILE_APP'
    if branch in ('single_image', 'single_video', 'leads_website_image'):
        return 'LEARN_MORE'
    return None


def optimization_goal(objective: str, branch: str | None) -> str:
    if objective == 'OUTCOME_SALES':
        return 'OFFSITE_CONVERSIONS'
    if objective == 'OUTCOME_LEADS' and branch == 'instant_form_image':
        return 'LEAD_GENERATION'
    if objective == 'OUTCOME_LEADS':
        return 'LINK_CLICKS'
    if objective == 'OUTCOME_AWARENESS':
        return 'THRUPLAY' if branch == 'single_video' else 'REACH'
    if objective == 'OUTCOME_ENGAGEMENT':
        return 'THRUPLAY' if branch == 'single_video' else 'POST_ENGAGEMENT'
    if objective == 'OUTCOME_APP_PROMOTION':
        return 'APP_INSTALLS'
    return 'LINK_CLICKS'


def estimate_max_spend(daily: float, end_time_iso: str, start_time_iso: str | None = None) -> tuple[float, int]:
    end = datetime.fromisoformat(end_time_iso.replace('+0000', '+00:00'))
    start = (
        datetime.fromisoformat(start_time_iso.replace('+0000', '+00:00'))
        if start_time_iso
        else datetime.now(timezone.utc)
    )
    days = max(1, (end.date() - start.date()).days + 1)
    return round(daily * days, 2), days


def collect_missing_lines(
    ctx: dict[str, Any],
    prompt: str,
    *,
    objective: str | None,
    branch: str | None,
    image_video_ambiguous: bool,
    pages: list[dict[str, str]],
    page_ids: list[str],
    geo: list[str] | None,
    geo_intent: Any | None = None,
    budget: float | None,
    end_time: str | None,
    link_url: str | None,
    lead_form_id: str | None,
    app_id: str | None,
    store_url: str | None,
    dsa_required: bool,
    dsa_beneficiary: str | None,
    dsa_payor: str | None,
    sales_blocked_no_pixel: bool,
) -> list[str]:
    """Missing required/conditional params — driven by workflow_spec."""
    history = ctx.get('conversation_history') or []
    full_text = full_conversation_text(prompt, history)
    has_image = bool(primary_image_attachment(ctx) or public_image_url_from_prompt(full_text))
    has_video = bool(primary_video_attachment(ctx))
    link_ok = not link_url or is_meta_acceptable_destination_url(link_url)
    missing_params = compute_meta_missing(
        objective=objective,
        branch=branch,
        image_video_ambiguous=image_video_ambiguous,
        pages=pages,
        page_ids=page_ids,
        geo=geo,
        geo_intent=geo_intent.to_payload() if geo_intent else None,
        budget=budget,
        end_time=end_time,
        link_url=link_url,
        lead_form_id=lead_form_id,
        app_id=app_id,
        store_url=store_url,
        dsa_required=dsa_required,
        dsa_beneficiary=dsa_beneficiary,
        dsa_payor=dsa_payor,
        sales_blocked_no_pixel=sales_blocked_no_pixel,
        has_image=has_image,
        has_video=has_video,
        link_url_acceptable=link_ok,
    )
    return [m.as_line() for m in missing_params]


def meta_content_missing_lines(ctx: dict[str, Any], prompt: str) -> list[str]:
    """Backward-compatible wrapper used after Page discovery."""
    objective, _source = resolve_meta_objective(
        prompt,
        workspace_id=ctx.get('workspace_id'),
    )
    if objective is None:
        branch, amb = None, False
    else:
        branch, amb = resolve_branch(objective, ctx, prompt)
    pages = fetch_usable_pages({'account_id': ctx.get('account_id'), 'workspace_id': ctx.get('workspace_id')})
    page_ids = resolve_page_ids(prompt, pages) if pages else []
    if len(pages) == 1:
        page_ids = [pages[0]['id']]
    app_id, store_url = extract_app_ids(prompt)
    return collect_missing_lines(
        ctx,
        prompt,
        objective=objective,
        branch=branch,
        image_video_ambiguous=amb,
        pages=pages,
        page_ids=page_ids,
        geo=resolve_geo_countries(prompt),
        budget=extract_daily_budget(prompt),
        end_time=extract_end_time_iso(prompt),
        link_url=extract_destination_url(prompt),
        lead_form_id=extract_lead_form_id(prompt),
        app_id=app_id,
        store_url=store_url,
        dsa_required=False,
        dsa_beneficiary=None,
        dsa_payor=None,
        sales_blocked_no_pixel=False,
    )


def is_meta_review_message(content: str) -> bool:
    return any(m in (content or '') for m in _REVIEW_MARKERS)


def is_meta_campaign_approval(message: str, conversation_history: list[dict[str, Any]] | None) -> bool:
    if not _APPROVE_RE.search(message or ''):
        return False
    for msg in reversed(conversation_history or []):
        if msg.get('role') == 'assistant':
            return is_meta_review_message(str(msg.get('content') or ''))
    return False


def build_review_message(compiled: MetaCampaignCompiled) -> str:
    page_label = ', '.join(compiled.page_names) if compiled.page_names else ', '.join(compiled.page_ids)
    lines = [
        'Campaign Review',
        '',
        f'Objective: {compiled.objective.replace("OUTCOME_", "").title()}'
        + (' (inferred from your request)' if compiled.objective_inferred else ''),
        f'Budget: ${compiled.budget_amount:.0f}/day (CBO)',
        f'Estimated maximum spend: ${compiled.estimated_max_spend:.0f} '
        f'(${compiled.budget_amount:.0f}/day × {compiled.day_count} days until {compiled.end_time[:10]})',
        f'Locations: {(compiled.geo_intent.display_label() if compiled.geo_intent else ", ".join(compiled.geo_countries))}',
    ]
    if compiled.start_time:
        lines.append(f'Start date: {compiled.start_time[:10]}')
    lines.extend([
        f'End date: {compiled.end_time[:10]}',
        f'Facebook Page: {page_label}',
        f'Creative branch: {compiled.branch}',
        f'Status: {compiled.status}',
    ])
    if compiled.link_url:
        lines.append(f'Website: {compiled.link_url}')
    if compiled.lead_gen_form_id:
        lines.append(f'Lead form ID: {compiled.lead_gen_form_id}')
    if compiled.pixel_id:
        lines.append(f'Pixel: {compiled.pixel_id}')

    copy_label = ' (generated)' if compiled.copy_generated else ''
    lines.extend([
        '',
        f'Ad copy{copy_label}:',
        f'  Message: {compiled.message}',
        f'  Headline: {compiled.headline}',
    ])
    if compiled.description:
        lines.append(f'  Description: {compiled.description}')

    if len(compiled.page_ids) > 1:
        n = len(compiled.page_ids)
        lines.extend([
            '',
            f'This will create 1 creative and 1 ad for each selected Page ({n} ads total).',
        ])

    lines.extend([
        '',
        f'Approve and spend up to ${compiled.estimated_max_spend:.0f} on this campaign?',
        'Type APPROVE to continue.',
    ])
    return '\n'.join(lines)


def compile_meta_campaign(
    *,
    name: str,
    prompt: str,
    ctx: dict[str, Any],
    base_payload: dict[str, Any],
    page_ids: list[str],
    page_names: list[str],
) -> tuple[MetaCampaignCompiled | None, list[str], bool, str, dict[str, Any]]:
    """Returns (compiled, missing_lines, needs_discovery, understood_summary, collected_fields)."""
    workspace_id = base_payload.get('workspace_id') or ctx.get('workspace_id')
    history = ctx.get('conversation_history') or []

    pages = fetch_usable_pages(base_payload)
    if not pages and history:
        for msg in reversed(history):
            if msg.get('role') == 'assistant':
                cached = pages_from_assistant_message(str(msg.get('content') or ''))
                if cached:
                    pages = cached
                    break

    if not pages:
        return None, [], True, '', {}

    collected_fields: dict[str, Any] = {}

    if not page_ids:
        if len(pages) == 1:
            page_ids = [pages[0]['id']]
            page_names = [pages[0]['name']]
        else:
            page_ids = resolve_page_ids_from_conversation(prompt, pages, history)

    if page_ids and pages and not page_names:
        id_to_name = {p['id']: p['name'] for p in pages}
        page_names = [id_to_name.get(pid, pid) for pid in page_ids]

    full_text = full_conversation_text(prompt, history)

    from lib.planner.meta_campaign_llm import extract_with_planner_llm

    trace = ctx.get('planner_trace')
    if trace is not None:
        trace.log_llm('Extract campaign parameters', feature='Planner', source='meta_campaign_collection')
    llm_fields = extract_with_planner_llm(
        prompt=full_text,
        conversation_history=None,
        pages=pages,
        workspace_id=workspace_id,
    )

    regex_objective, objective_source = resolve_meta_objective(full_text, workspace_id=workspace_id)
    objective = llm_fields.objective if llm_fields and llm_fields.objective else regex_objective
    if llm_fields and llm_fields.objective:
        objective_source = 'inferred'
    geo = (
        llm_fields.geo_countries
        if llm_fields and llm_fields.geo_countries
        else resolve_geo_countries(full_text, base_payload)
    )
    geo_intent = extract_geo_targeting_intent(
        prompt=full_text,
        conversation_history=None,
        workspace_id=str(workspace_id) if workspace_id else None,
        llm_geo_fields={'geo_countries': llm_fields.geo_countries} if llm_fields and llm_fields.geo_countries else None,
    )
    if llm_fields and llm_fields.geo_countries:
        geo_intent = merge_geo_intent_with_llm_countries(geo_intent, llm_fields.geo_countries)
    if geo_intent and geo_intent.has_locations():
        geo = geo_intent.country_codes() or geo
    needs_geo_resolve = bool(geo_intent and geo_intent.has_locations())
    budget = (
        llm_fields.daily_budget
        if llm_fields and llm_fields.daily_budget is not None
        else extract_daily_budget(full_text)
    )
    regex_start, regex_end = extract_schedule_times(full_text)
    start_time = llm_fields.start_time if llm_fields and llm_fields.start_time else regex_start
    end_time = llm_fields.end_time if llm_fields and llm_fields.end_time else regex_end
    link_url = (
        llm_fields.link_url
        if llm_fields and llm_fields.link_url
        else extract_destination_url(full_text)
    )
    lead_form_id = extract_lead_form_id(full_text)
    app_id, store_url = extract_app_ids(full_text)
    format_hint: Literal['image', 'video'] | None = None

    understood_summary = (llm_fields.understood_summary or '') if llm_fields else ''
    if llm_fields:
        if llm_fields.page_ids:
            page_ids = llm_fields.page_ids
            id_to_name = {p['id']: p['name'] for p in pages}
            page_names = [id_to_name.get(pid, pid) for pid in page_ids]
        if llm_fields.lead_form_id:
            lead_form_id = llm_fields.lead_form_id
        if llm_fields.application_id:
            app_id = llm_fields.application_id
        if llm_fields.store_url:
            store_url = llm_fields.store_url
        if llm_fields.creative_format:
            format_hint = llm_fields.creative_format

    collected_fields = {
        'objective': objective,
        'page_ids': page_ids,
        'page_names': page_names,
        'budget': budget,
        'start_time': start_time,
        'end_time': end_time,
        'geo': geo,
        'geo_intent': geo_intent.to_payload() if geo_intent else None,
        'link_url': link_url,
        'format_hint': format_hint,
    }

    if not understood_summary:
        understood_summary = build_collected_acknowledgment(collected_fields)

    if objective is None:
        branch, image_video_ambiguous = None, False
    else:
        branch, image_video_ambiguous = resolve_branch_with_format(
            objective, ctx, full_text, format_hint=format_hint,
        )
        if objective == 'OUTCOME_LEADS' and branch is None:
            image_video_ambiguous = False

    dsa_required = bool(geo and EU_ISO.intersection(set(geo)))
    dsa_beneficiary = dsa_payor = None
    if dsa_required:
        try:
            from tools.ads._resolve import enrich_ads_tool_payload
            from tools.ads.registry import run_ads_tool

            acct = run_ads_tool(
                'meta_get_account',
                enrich_ads_tool_payload('meta_get_account', dict(base_payload)),
            )
            if acct.get('ok'):
                legal = (
                    str(acct.get('business_name') or acct.get('name') or acct.get('account_name') or '')
                    .strip()
                )
                if legal:
                    dsa_beneficiary = dsa_payor = legal
        except Exception:
            pass
        if not dsa_beneficiary:
            dsa_beneficiary = dsa_payor = 'Advertiser'

    sales_blocked = False
    if objective == 'OUTCOME_SALES':
        try:
            from tools.ads._resolve import enrich_ads_tool_payload
            from tools.ads.registry import run_ads_tool

            px = run_ads_tool(
                'meta_list_ad_pixels',
                enrich_ads_tool_payload('meta_list_ad_pixels', dict(base_payload)),
            )
            pixels = (px.get('data') or []) if px.get('ok') else []
            if not pixels:
                sales_blocked = True
        except Exception:
            sales_blocked = True

    missing = collect_missing_lines(
        ctx,
        prompt,
        objective=objective,
        branch=branch,
        image_video_ambiguous=image_video_ambiguous,
        pages=pages,
        page_ids=page_ids,
        geo=geo,
        geo_intent=geo_intent,
        budget=budget,
        end_time=end_time,
        link_url=link_url,
        lead_form_id=lead_form_id,
        app_id=app_id,
        store_url=store_url,
        dsa_required=dsa_required,
        dsa_beneficiary=dsa_beneficiary,
        dsa_payor=dsa_payor,
        sales_blocked_no_pixel=sales_blocked,
    )

    collected_fields.update({
        'branch': branch,
        'image_video_ambiguous': image_video_ambiguous,
        'lead_form_id': lead_form_id,
        'app_id': app_id,
        'store_url': store_url,
        'dsa_required': dsa_required,
        'dsa_beneficiary': dsa_beneficiary,
        'dsa_payor': dsa_payor,
        'sales_blocked_no_pixel': sales_blocked,
    })

    if missing or branch is None:
        return None, missing, False, understood_summary, collected_fields

    attachment_img = primary_image_attachment(ctx)
    attachment_vid = primary_video_attachment(ctx)
    media_id: str | None = None
    image_url: str | None = None
    video_url: str | None = None
    if branch_is_video(branch):
        if attachment_vid:
            media_id = str(attachment_vid.get('id') or '') or None
    else:
        if attachment_img:
            media_id = str(attachment_img.get('id') or '') or None
        image_url = public_image_url_from_prompt(prompt) if not media_id else None

    if objective == 'OUTCOME_AWARENESS' and not link_url:
        link_url = None

    message, headline, description, copy_generated = resolve_creative_copy(
        name,
        objective,
        full_text,
        conversation_history=history,
        workspace_id=str(workspace_id) if workspace_id else None,
        link_url=link_url,
    )
    assert budget is not None and end_time is not None
    assert geo_intent is not None and geo_intent.has_locations()

    max_spend, day_count = estimate_max_spend(budget, end_time, start_time)

    compiled = MetaCampaignCompiled(
        name=name,
        objective=objective,
        branch=branch,
        budget_amount=budget,
        end_time=end_time,
        start_time=start_time,
        geo_countries=geo or [],
        geo_intent=geo_intent,
        needs_geo_resolve=needs_geo_resolve,
        page_ids=page_ids,
        page_names=page_names or page_ids,
        link_url=link_url,
        lead_gen_form_id=lead_form_id,
        application_id=app_id,
        object_store_url=store_url,
        media_id=media_id,
        image_url=image_url,
        video_url=video_url,
        message=message,
        headline=headline,
        description=description,
        copy_generated=copy_generated,
        dsa_beneficiary=dsa_beneficiary,
        dsa_payor=dsa_payor,
        estimated_max_spend=max_spend,
        day_count=day_count,
        objective_inferred=objective_source == 'inferred',
    )
    return compiled, [], False, understood_summary, collected_fields


def build_cbo_execute_steps(base: dict[str, Any], compiled: MetaCampaignCompiled) -> list[dict[str, Any]]:
    """Spec step 8 order: campaign → adset → upload → creative → ad."""
    og = optimization_goal(compiled.objective, compiled.branch)
    cta = cta_for_branch(compiled.branch)
    steps: list[dict[str, Any]] = [
        {
            'step_id': 'step_1',
            'tool_id': 'meta_get_account',
            'payload': dict(base),
            'depends_on': [],
        },
    ]
    next_i = 2
    pixel_step = None
    geo_resolve_step: str | None = None

    if compiled.geo_intent and compiled.needs_geo_resolve:
        geo_resolve_step = f'step_{next_i}'
        steps.append({
            'step_id': geo_resolve_step,
            'tool_id': 'meta_resolve_geo_targeting',
            'payload': {**base, **compiled.geo_intent.to_payload(), 'api_version': 'v22.0'},
            'depends_on': ['step_1'],
        })
        next_i += 1

    if compiled.objective == 'OUTCOME_SALES':
        pixel_step = f'step_{next_i}'
        steps.append({
            'step_id': pixel_step,
            'tool_id': 'meta_list_ad_pixels',
            'payload': dict(base),
            'depends_on': ['step_1'],
        })
        next_i += 1

    campaign_step = f'step_{next_i}'
    steps.append({
        'step_id': campaign_step,
        'tool_id': 'meta_create_campaign',
        'payload': {
            **base,
            'name': compiled.name,
            'objective': compiled.objective,
            'status': compiled.status,
            'use_adset_level_budgets': False,
            'campaign_budget_optimization': True,
            'bid_strategy': 'LOWEST_COST_WITHOUT_CAP',
            'budget': {'amount': compiled.budget_amount, 'type': 'daily'},
            'api_version': 'v22.0',
        },
        'depends_on': ['step_1'],
        'requires_approval': True,
    })
    next_i += 1

    if geo_resolve_step:
        targeting: dict[str, Any] = {
            'geo_locations': f'${geo_resolve_step}.output.geo_locations',
        }
        if compiled.geo_intent and compiled.geo_intent.exclude:
            targeting['excluded_geo_locations'] = f'${geo_resolve_step}.output.excluded_geo_locations'
    else:
        targeting = {'geo_locations': {'countries': compiled.geo_countries}}
    adset_payload: dict[str, Any] = {
        **base,
        'name': f'{compiled.name} — Ad Set',
        'campaign_id': f'${campaign_step}.output.platform_campaign_id',
        'objective': compiled.objective,
        'optimization_goal': og,
        'billing_event': 'IMPRESSIONS',
        'status': compiled.status,
        'targeting': targeting,
        'end_time': compiled.end_time,
        'bid_strategy': 'LOWEST_COST_WITHOUT_CAP',
        'use_resolve_targeting': True,
        'cbo_parent': True,
        'api_version': 'v22.0',
    }
    if compiled.start_time:
        adset_payload['start_time'] = compiled.start_time
    if compiled.link_url:
        adset_payload['link_url'] = compiled.link_url
    if compiled.page_ids:
        adset_payload['page_id'] = compiled.page_ids[0]
    if compiled.lead_gen_form_id:
        adset_payload['lead_gen_form_id'] = compiled.lead_gen_form_id
    if compiled.application_id:
        adset_payload['application_id'] = compiled.application_id
    if compiled.object_store_url:
        adset_payload['object_store_url'] = compiled.object_store_url
    if compiled.dsa_beneficiary:
        adset_payload['dsa_beneficiary'] = compiled.dsa_beneficiary
        adset_payload['dsa_payor'] = compiled.dsa_payor
    if pixel_step:
        adset_payload['pixel_id'] = f'${pixel_step}.output.default_pixel_id'

    adset_deps = [campaign_step]
    if geo_resolve_step:
        adset_deps.append(geo_resolve_step)
    adset_step = f'step_{next_i}'
    steps.append({
        'step_id': adset_step,
        'tool_id': 'meta_create_adset',
        'payload': adset_payload,
        'depends_on': adset_deps,
        'requires_approval': True,
    })
    next_i += 1

    upload_tool = 'meta_upload_ad_video' if branch_is_video(compiled.branch) else 'meta_upload_ad_image'
    upload_payload: dict[str, Any] = {
        **base,
        'name': f'{compiled.name} — Media',
        'api_version': 'v22.0',
        'workspace_id': base.get('workspace_id'),
    }
    if branch_is_video(compiled.branch):
        if compiled.media_id:
            upload_payload['media_id'] = compiled.media_id
        elif compiled.video_url:
            upload_payload['video_url'] = compiled.video_url
    else:
        if compiled.media_id:
            upload_payload['media_id'] = compiled.media_id
        elif compiled.image_url:
            upload_payload['image_url'] = compiled.image_url

    upload_step = f'step_{next_i}'
    steps.append({
        'step_id': upload_step,
        'tool_id': upload_tool,
        'payload': upload_payload,
        'depends_on': [adset_step],
        'requires_approval': True,
    })
    next_i += 1

    media_ref = (
        f'${upload_step}.output.video_id'
        if branch_is_video(compiled.branch)
        else f'${upload_step}.output.image_hash'
    )

    for idx, page_id in enumerate(compiled.page_ids):
        suffix = f' — Page {idx + 1}' if len(compiled.page_ids) > 1 else ''
        creative_payload: dict[str, Any] = {
            **base,
            'page_id': page_id,
            'name': f'{compiled.name} — Creative{suffix}',
            'message': compiled.message,
            'headline': compiled.headline,
            'api_version': 'v22.0',
        }
        if branch_is_video(compiled.branch):
            creative_payload['video_id'] = media_ref
        else:
            creative_payload['image_hash'] = media_ref
        if compiled.link_url:
            creative_payload['link_url'] = compiled.link_url
        if compiled.lead_gen_form_id:
            creative_payload['lead_gen_form_id'] = compiled.lead_gen_form_id
        if compiled.description:
            creative_payload['description'] = compiled.description
        if cta:
            creative_payload['call_to_action_type'] = cta

        creative_step = f'step_{next_i}'
        steps.append({
            'step_id': creative_step,
            'tool_id': 'meta_create_creative',
            'payload': creative_payload,
            'depends_on': [upload_step],
            'requires_approval': True,
        })
        next_i += 1

        steps.append({
            'step_id': f'step_{next_i}',
            'tool_id': 'meta_create_ad',
            'payload': {
                **base,
                'adset_id': f'${adset_step}.output.platform_ad_set_id',
                'creative_id': f'${creative_step}.output.creative_id',
                'name': f'{compiled.name} — Ad{suffix}',
                'status': compiled.status,
                'api_version': 'v22.0',
            },
            'depends_on': [adset_step, creative_step],
            'requires_approval': True,
        })
        next_i += 1

    return steps


def preview_meta_execute_tool_ids(objective: str | None = None) -> list[str]:
    ids = ['meta_get_account']
    if objective == 'OUTCOME_SALES':
        ids.append('meta_list_ad_pixels')
    ids.extend([
        'meta_create_campaign',
        'meta_create_adset',
        'meta_upload_ad_image',
        'meta_create_creative',
        'meta_create_ad',
    ])
    return ids


def plan_meta_create_workflow(
    *,
    prompt: str,
    ctx: dict[str, Any],
    base_payload: dict[str, Any],
    name: str,
) -> dict[str, Any]:
    """Entry point for Meta campaign create (SPEC-compliant)."""
    from lib.planner.ads_session import is_ads_collection_active
    from lib.planner.planner_trace import PlannerTrace

    if not ctx.get('planner_trace'):
        ctx['planner_trace'] = PlannerTrace()

    history = ctx.get('conversation_history') or []
    workspace_id = base_payload.get('workspace_id') or ctx.get('workspace_id')
    pages = fetch_usable_pages(base_payload)
    page_ids = resolve_page_ids_from_conversation(prompt, pages, history) if pages else []
    page_names = [p['name'] for p in pages if p['id'] in page_ids]

    compiled, missing, needs_discovery, understood_summary, collected = compile_meta_campaign(
        name=name,
        prompt=prompt,
        ctx=ctx,
        base_payload=base_payload,
        page_ids=page_ids,
        page_names=page_names,
    )

    if needs_discovery:
        discovery_msg = render_agent_message(
            workspace_id=str(workspace_id) if workspace_id else None,
            phase='acknowledge',
            workflow_label='Meta Ads campaign',
            facts={'phase': 'account_discovery'},
            extra_instructions='Explain we are loading the Meta ad account and Facebook Pages, then will collect campaign details.',
        )
        return {
            'meta_setup_phase': 'discovery',
            'intent': 'ads_campaign',
            'summary': 'Discover Meta account and Facebook Pages for ad setup.',
            'assistant_message': discovery_msg,
            'steps': _meta_discovery_steps(base_payload),
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
            'requires_approval': False,
        }

    if missing:
        obj = collected.get('objective')
        spec_label = (
            f'Meta {str(obj).replace("OUTCOME_", "").title()} campaign'
            if obj
            else 'Meta Ads campaign'
        )
        full_text = full_conversation_text(prompt, history)
        has_image = bool(primary_image_attachment(ctx) or public_image_url_from_prompt(full_text))
        has_video = bool(primary_video_attachment(ctx))
        link_url_val = collected.get('link_url')
        link_ok = not link_url_val or is_meta_acceptable_destination_url(str(link_url_val))
        missing_params = compute_meta_missing(
            objective=collected.get('objective'),
            branch=collected.get('branch'),
            image_video_ambiguous=bool(collected.get('image_video_ambiguous')),
            pages=pages,
            page_ids=page_ids,
            geo=collected.get('geo'),
            budget=collected.get('budget'),
            end_time=collected.get('end_time'),
            link_url=link_url_val,
            lead_form_id=collected.get('lead_form_id'),
            app_id=collected.get('app_id'),
            store_url=collected.get('store_url'),
            dsa_required=bool(collected.get('dsa_required')),
            dsa_beneficiary=collected.get('dsa_beneficiary'),
            dsa_payor=collected.get('dsa_payor'),
            sales_blocked_no_pixel=bool(collected.get('sales_blocked_no_pixel')),
            has_image=has_image,
            has_video=has_video,
            link_url_acceptable=link_ok,
        )
        facts: dict[str, Any] = enrich_facts_for_dialogue(
            {k: v for k, v in collected.items() if v is not None}
        )
        if understood_summary:
            facts['understood_summary'] = understood_summary
        clarification = render_agent_message(
            workspace_id=str(workspace_id) if workspace_id else None,
            phase='collect',
            workflow_label=spec_label,
            facts=facts,
            missing=missing_params,
            use_llm=True,
        )
        graph = {
            'intent': 'informational',
            'collection_phase': True,
            'summary': 'Collect campaign details before Meta create (SPEC).',
            'assistant_message': clarification,
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
            'execute_plan': preview_meta_execute_tool_ids(collected.get('objective')),
        }
        trace = ctx.get('planner_trace')
        if trace is not None:
            trace.attach(graph)
        return graph

    assert compiled is not None

    if not is_meta_campaign_approval(prompt, history):
        obj_label = str(compiled.objective or '').replace('OUTCOME_', '').title()
        review = render_agent_message(
            workspace_id=str(workspace_id) if workspace_id else None,
            phase='review',
            workflow_label=f'Meta {obj_label} campaign',
            facts=compiled_meta_facts(compiled),
            extra_instructions='End with: Type APPROVE to continue.',
        )
        return {
            'intent': 'informational',
            'meta_setup_phase': 'ready_for_review',
            'meta_compiled': asdict(compiled),
            'meta_account_id': base_payload.get('account_id'),
            'summary': f'Review Meta campaign "{name}" before create.',
            'assistant_message': review,
            'steps': [],
            'dependencies': [],
            'parallel_groups': [],
            'approval_gates': [],
            'requires_approval': True,
        }

    steps = build_cbo_execute_steps(base_payload, compiled)
    gates = [s['step_id'] for s in steps if s.get('requires_approval')]
    geo_label = (
        compiled.geo_intent.display_label()
        if compiled.geo_intent
        else ', '.join(compiled.geo_countries)
    )
    success_msg = render_agent_message(
        workspace_id=str(workspace_id) if workspace_id else None,
        phase='success',
        workflow_label=f'Meta {str(compiled.objective).replace("OUTCOME_", "").title()} campaign',
        facts=compiled_meta_facts(compiled),
        success_detail=f'Executing CBO chain for "{name}" ({geo_label}, PAUSED on Meta).',
    )
    return {
        'intent': 'ads_campaign',
        'meta_compiled': asdict(compiled),
        'meta_account_id': base_payload.get('account_id'),
        'summary': f'Create paused Meta CBO campaign "{name}" ({geo_label}, {compiled.objective}).',
        'assistant_message': success_msg,
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': gates,
        'requires_approval': True,
    }


def compiled_from_graph(graph: dict[str, Any]) -> MetaCampaignCompiled | None:
    raw = graph.get('meta_compiled')
    if not isinstance(raw, dict):
        return None
    from lib.planner.geo_targeting_intent import restore_geo_intent

    kwargs = {k: raw[k] for k in MetaCampaignCompiled.__dataclass_fields__ if k in raw}
    if 'geo_intent' in kwargs:
        kwargs['geo_intent'] = restore_geo_intent(kwargs['geo_intent'])
    return MetaCampaignCompiled(**kwargs)


def materialize_meta_compiled_graph(
    graph: dict[str, Any],
    *,
    account_id: str,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """
    Expand stored meta_compiled into an executable CBO step graph (UI Approve path).
  """
    if graph.get('steps'):
        return graph
    compiled = compiled_from_graph(graph)
    if not compiled:
        return graph

    base = {'account_id': account_id, 'workspace_id': workspace_id}
    steps = build_cbo_execute_steps(base, compiled)
    gates = [s['step_id'] for s in steps if s.get('requires_approval')]
    geo_label = (
        compiled.geo_intent.display_label()
        if compiled.geo_intent
        else ', '.join(compiled.geo_countries)
    )
    return {
        **graph,
        'intent': 'ads_campaign',
        'meta_setup_phase': 'approved',
        'summary': (
            graph.get('summary')
            or f'Create paused Meta CBO campaign "{compiled.name}" ({geo_label}).'
        ),
        'assistant_message': (
            f'Approved — executing CBO chain: campaign → ad set → upload → creative → ad '
            f'(${compiled.budget_amount:.0f}/day, PAUSED on Meta).'
        ),
        'steps': steps,
        'dependencies': graph.get('dependencies') or [],
        'parallel_groups': graph.get('parallel_groups') or [],
        'approval_gates': gates,
        'requires_approval': True,
    }
