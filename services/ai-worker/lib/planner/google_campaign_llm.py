"""LLM marketing intelligence for Google Ads — keywords, RSA copy, etc."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_RSA_HEADLINE_MAX = 30
_RSA_DESCRIPTION_MAX = 90


def _conversation_block(prompt: str, history: list[dict[str, Any]] | None) -> str:
    lines: list[str] = []
    for msg in history or []:
        role = str(msg.get('role') or 'user')
        content = str(msg.get('content') or '').strip()
        if content:
            lines.append(f'{role}: {content}')
    if prompt and (not lines or lines[-1] != f'user: {prompt.strip()}'):
        lines.append(f'user: {prompt.strip()}')
    return '\n'.join(lines[-12:])


def _google_marketing_llm_config(workspace_id: str | None):
    try:
        from lib.ai_workspace_config import get_ads_marketing_config

        return get_ads_marketing_config(workspace_id, 'google_search_marketing')
    except Exception:
        return None


def _complete_json_llm(
    *,
    llm_prompt: str,
    workspace_id: str | None,
    source: str,
    max_tokens: int = 500,
) -> dict[str, Any] | None:
    from lib.planner.ads_llm import complete_ads_json_llm

    return complete_ads_json_llm(
        workspace_id=workspace_id,
        prompt=llm_prompt,
        source=source,
        temperature=0.25,
        max_tokens=max_tokens,
        opcode='google_search_marketing',
    )


def _truncate_rsa(text: str, max_len: int) -> str:
    s = re.sub(r'\s+', ' ', (text or '').strip())
    if len(s) <= max_len:
        return s
    cut = s[:max_len].rsplit(' ', 1)[0]
    return cut or s[:max_len]


def generate_seed_keywords_with_llm(
    *,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    business_context: str | None,
    geo_countries: list[str] | None,
    final_url: str | None,
    workspace_id: str | None,
) -> list[str] | None:
    """Return 4–10 commercial-intent seed keywords, or None if LLM unavailable."""
    convo = _conversation_block(prompt, conversation_history)
    geo_label = ', '.join(geo_countries or []) or 'unspecified'
    business = (business_context or 'unspecified').strip()

    llm_prompt = f"""You generate Google Search ad seed keywords for Keyword Planner expansion.

Business / offer: {business}
Target countries (ISO): {geo_label}
Landing page: {final_url or 'not provided'}

Conversation:
{convo}

Return JSON only:
{{
  "keywords": ["keyword 1", "keyword 2"]
}}

Rules:
- 4 to 10 keywords, each 2–6 words when possible
- Commercial / transactional intent (buy, best, near me, product names) — not brand slogans
- Match the user's actual business from the conversation
- Include geo modifiers only when targeting is explicit
- No single-word generic terms like "wellness", "nutrition", "exercise", "lifestyle"
- No duplicates; lowercase except proper nouns
- Do not invent unrelated verticals"""

    parsed = _complete_json_llm(
        llm_prompt=llm_prompt,
        workspace_id=workspace_id,
        source='google_keyword_seeds',
        max_tokens=400,
    )
    if not parsed:
        return None
    kws = parsed.get('keywords')
    if not isinstance(kws, list):
        return None
    out = [str(k).strip() for k in kws if str(k).strip()]
    return out[:12] or None


def generate_rsa_copy_with_llm(
    *,
    campaign_name: str,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    business_context: str | None,
    final_url: str | None,
    campaign_type: str,
    geo_countries: list[str] | None,
    workspace_id: str | None,
) -> tuple[list[str], list[str]] | None:
    """Generate RSA headlines and descriptions, or None if LLM unavailable."""
    convo = _conversation_block(prompt, conversation_history)
    geo_label = ', '.join(geo_countries or []) or 'unspecified'
    business = (business_context or campaign_name or 'unspecified').strip()

    llm_prompt = f"""You write Google Responsive Search Ad (RSA) copy.

Campaign name: {campaign_name}
Campaign type: {campaign_type}
Business / offer: {business}
Target countries (ISO): {geo_label}
Landing page: {final_url or 'not provided'}

Conversation:
{convo}

Return JSON only:
{{
  "headlines": ["headline 1", "headline 2"],
  "descriptions": ["description 1", "description 2"]
}}

Rules:
- 3 to 8 unique headlines, each max {_RSA_HEADLINE_MAX} characters
- 2 to 3 unique descriptions, each max {_RSA_DESCRIPTION_MAX} characters
- Match the user's actual business and offer — do not use generic fitness/travel/legal templates
- Include a clear call to action; mention the brand or campaign name in at least one headline
- No exclamation spam; no misleading claims"""

    parsed = _complete_json_llm(
        llm_prompt=llm_prompt,
        workspace_id=workspace_id,
        source='google_rsa_copy',
        max_tokens=500,
    )
    if not parsed:
        return None

    raw_h = parsed.get('headlines')
    raw_d = parsed.get('descriptions')
    if not isinstance(raw_h, list) or not isinstance(raw_d, list):
        return None

    headlines = [
        _truncate_rsa(str(h), _RSA_HEADLINE_MAX)
        for h in raw_h
        if str(h).strip()
    ]
    descriptions = [
        _truncate_rsa(str(d), _RSA_DESCRIPTION_MAX)
        for d in raw_d
        if str(d).strip()
    ]
    if len(headlines) < 3 or len(descriptions) < 2:
        return None
    return headlines[:8], descriptions[:3]


def emergency_rsa_copy(
    campaign_name: str,
    *,
    business_context: str | None = None,
) -> tuple[list[str], list[str]]:
    """Minimal fallback when LLM is unavailable."""
    label = _truncate_rsa(
        (business_context or campaign_name or 'Our Business').strip(),
        _RSA_HEADLINE_MAX,
    )
    return (
        [label, 'Learn More Today', 'Get Started Now'],
        [
            _truncate_rsa(f'Discover {label} online — plan your visit today.', _RSA_DESCRIPTION_MAX),
            _truncate_rsa('Find details, offers, and booking on our website.', _RSA_DESCRIPTION_MAX),
        ],
    )


def resolve_google_ad_copy(
    *,
    campaign_name: str,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    business_context: str | None,
    final_url: str | None,
    campaign_type: str,
    geo_countries: list[str] | None,
    workspace_id: str | None,
) -> tuple[list[str], list[str], str]:
    """Return headlines, descriptions, and source ('llm' or 'fallback')."""
    generated = generate_rsa_copy_with_llm(
        campaign_name=campaign_name,
        prompt=prompt,
        conversation_history=conversation_history,
        business_context=business_context,
        final_url=final_url,
        campaign_type=campaign_type,
        geo_countries=geo_countries,
        workspace_id=workspace_id,
    )
    if generated:
        return generated[0], generated[1], 'llm'

    label = (business_context or campaign_name or 'Campaign').strip()
    headlines, descriptions = emergency_rsa_copy(label, business_context=business_context)
    logger.warning(
        'google_rsa_copy: LLM unavailable for workspace=%s; using fallback ad copy',
        workspace_id,
    )
    return headlines, descriptions, 'fallback'


def assess_search_promotion_context_with_llm(
    *,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    workspace_id: str | None,
) -> tuple[bool, str | None] | None:
    """
    Decide whether the conversation states what to advertise.
    Returns (promotion_clear, business_context) or None if LLM unavailable.
    """
    convo = _conversation_block(prompt, conversation_history)
    llm_prompt = f"""You decide if a Google Search campaign request has enough detail to auto-generate keywords and ad copy.

Conversation:
{convo}

Return JSON only:
{{
  "promotion_clear": true,
  "business_context": "short label of what they sell or offer"
}}

Set promotion_clear=false when the user only says "my business", "our company", or similar without describing products or services.
Set promotion_clear=true when the offer, products, or services are stated or clearly implied.
business_context: concise 3–12 word summary of the offer, or null when promotion_clear is false."""

    parsed = _complete_json_llm(
        llm_prompt=llm_prompt,
        workspace_id=workspace_id,
        source='google_promotion_context',
        max_tokens=250,
    )
    if not parsed:
        return None

    clear = bool(parsed.get('promotion_clear'))
    raw_ctx = parsed.get('business_context')
    business_context: str | None = None
    if raw_ctx is not None and str(raw_ctx).strip().lower() not in ('', 'null', 'none', 'unknown'):
        business_context = str(raw_ctx).strip()[:80]
    return clear, business_context


def resolve_search_promotion_context(
    *,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    final_url: str | None,
    workspace_id: str | None,
) -> tuple[bool, str | None]:
    """
    Workflow helper: can we auto-generate Search marketing assets?
    Uses regex extraction, then LLM — no hardcoded vertical keyword lists.
    """
    business_context = infer_business_context_from_prompt(prompt)
    if business_context or final_url:
        return True, business_context

    assessed = assess_search_promotion_context_with_llm(
        prompt=prompt,
        conversation_history=conversation_history,
        workspace_id=workspace_id,
    )
    if assessed is not None:
        clear, llm_ctx = assessed
        return clear, business_context or llm_ctx

    m = (prompt or '').lower()
    if re.search(r'\b(my business|our business|our company|my company)\b', m):
        return False, None
    return len(re.findall(r'\w+', m)) >= 10, business_context


def infer_business_context_from_prompt(prompt: str) -> str | None:
    """Extract what the user is promoting from explicit phrasing in the prompt."""
    text = prompt or ''
    _SKIP = frozenset({
        'business', 'company', 'brand', 'a', 'my',
        'my business', 'my company', 'my brand',
    })
    patterns = (
        r'\bfor my\s+(.+?)(?:\s+targeting|\s+in\s+[A-Za-z]|\s+\$|\s+until\b|$)',
        r'\b(?:advertising\s+)?setup\s+for\s+(.+?)(?:\s+targeting|\s+in\s+[A-Za-z]|\s+\$|\s+until\b|$)',
        r'\bfor\s+(.+?)\s+targeting\b',
    )
    for pat in patterns:
        biz = re.search(pat, text, re.I)
        if not biz:
            continue
        raw = biz.group(1).strip().rstrip('.,')
        if raw and raw.lower() not in _SKIP:
            return raw[:80]
    return None


@dataclass
class GoogleCampaignFieldExtraction:
    daily_budget: float | None = None
    end_time: str | None = None
    start_time: str | None = None
    final_url: str | None = None
    campaign_type: str | None = None
    geo_countries: list[str] | None = None
    geo_targeting: dict[str, Any] | None = None
    business_context: str | None = None
    campaign_name: str | None = None
    understood_summary: str = ''


_CAMPAIGN_NAME_MAX = 80


_VALID_GOOGLE_CAMPAIGN_TYPES = frozenset({
    'search', 'display', 'video', 'shopping', 'performance_max', 'app', 'local',
})


def _normalize_google_campaign_type(raw: Any) -> str | None:
    text = str(raw or '').strip().lower().replace('-', '_')
    if text in ('pmax', 'p_max', 'performance_max'):
        return 'performance_max'
    if text in _VALID_GOOGLE_CAMPAIGN_TYPES:
        return text
    return None


def _planner_config_for_collection(workspace_id: str | None):
    try:
        from lib.ai_workspace_config import get_planner_config

        return get_planner_config(workspace_id)
    except Exception:
        return None


def _sanitize_google_field_extraction(parsed: dict[str, Any]) -> GoogleCampaignFieldExtraction:
    from lib.planner.meta_campaign_llm import _normalize_end_time, _normalize_start_time

    fields = parsed.get('fields') if isinstance(parsed.get('fields'), dict) else parsed
    if not isinstance(fields, dict):
        fields = {}

    daily_budget: float | None = None
    budget_raw = fields.get('daily_budget')
    if budget_raw is not None:
        try:
            amount = float(budget_raw)
            if amount >= 1:
                daily_budget = amount
        except (TypeError, ValueError):
            pass

    link = str(fields.get('final_url') or fields.get('link_url') or '').strip() or None
    if link and not link.startswith('http'):
        link = None

    summary = str(parsed.get('understood_summary') or fields.get('understood_summary') or '').strip()

    raw_geo = fields.get('geo_countries')
    geo: list[str] | None = None
    if isinstance(raw_geo, list):
        geo = [str(c).strip().upper() for c in raw_geo if str(c).strip()]
    elif isinstance(raw_geo, str) and raw_geo.strip():
        geo = [raw_geo.strip().upper()]

    geo_targeting = fields.get('geo_targeting')
    geo_targeting_payload: dict[str, Any] | None = None
    if isinstance(geo_targeting, dict):
        from lib.planner.geo_targeting_intent import GeoTargetingIntent

        intent = GeoTargetingIntent.from_llm_fields({'geo_targeting': geo_targeting})
        if intent:
            geo_targeting_payload = geo_targeting
            if intent.country_codes():
                geo = intent.country_codes()

    business = str(fields.get('business_context') or fields.get('business') or '').strip() or None

    raw_name = str(fields.get('campaign_name') or fields.get('name') or '').strip() or None
    campaign_name = _truncate_campaign_name(raw_name) if raw_name else None

    return GoogleCampaignFieldExtraction(
        daily_budget=daily_budget,
        end_time=_normalize_end_time(fields.get('end_date') or fields.get('end_time')),
        start_time=_normalize_start_time(fields.get('start_date') or fields.get('start_time')),
        final_url=link,
        campaign_type=_normalize_google_campaign_type(fields.get('campaign_type')),
        geo_countries=geo,
        geo_targeting=geo_targeting_payload,
        business_context=business,
        campaign_name=campaign_name,
        understood_summary=summary,
    )


def _truncate_campaign_name(text: str | None) -> str | None:
    name = re.sub(r'\s+', ' ', (text or '').strip())
    if len(name) < 3:
        return None
    return name[:_CAMPAIGN_NAME_MAX]


def explicit_campaign_name_from_prompt(message: str) -> str | None:
    """User literally named the campaign — honor verbatim."""
    m = (message or '').strip()
    quoted = re.search(r'["\']([^"\']{3,80})["\']', m)
    if quoted:
        return _truncate_campaign_name(quoted.group(1).strip())
    for prefix in ('called ', 'named '):
        if prefix in m.lower():
            idx = m.lower().index(prefix) + len(prefix)
            tail = m[idx:].split('.')[0].split(',')[0].strip()
            return _truncate_campaign_name(tail)
    return None


def emergency_campaign_name(
    *,
    prompt: str,
    campaign_type: str | None = None,
    geo_label: str | None = None,
    final_url: str | None = None,
    business_context: str | None = None,
) -> str:
    """Last resort when the planner LLM is unavailable (quota, config, etc.)."""
    from datetime import datetime, timezone
    from urllib.parse import urlparse

    stamp = datetime.now(timezone.utc).strftime('%m%d-%H%M')
    kind = (campaign_type or 'search').replace('_', ' ').title()
    if business_context:
        base = business_context[:40].strip()
        return _truncate_campaign_name(f'{base} {kind} {stamp}') or f'{kind} {stamp}'

    url = final_url or ''
    if not url:
        url_m = re.search(r'https?://[^\s\'"]+', prompt or '', re.I)
        url = url_m.group(0) if url_m else ''
    if url:
        try:
            host = urlparse(url).netloc.replace('www.', '')
            brand = (host.split('.')[0] or '').strip()
            if len(brand) >= 3:
                geo_bit = ''
                if geo_label:
                    geo_bit = ' ' + geo_label.split(',')[0].strip()[:24]
                return _truncate_campaign_name(f'{brand.title()} {kind}{geo_bit} {stamp}') or f'{kind} {stamp}'
        except Exception:
            pass

    if geo_label:
        return _truncate_campaign_name(f'{kind} — {geo_label[:40]} {stamp}') or f'{kind} {stamp}'
    return f'{kind} {stamp}'


def resolve_google_campaign_name(
    *,
    prompt: str,
    llm_fields: GoogleCampaignFieldExtraction | None = None,
    campaign_type: str | None = None,
    geo_label: str | None = None,
    final_url: str | None = None,
    business_context: str | None = None,
) -> str:
    """
    MCP-style: model proposes a meaningful campaign name from conversation context.
    Regex/heuristics only when the planner LLM is down.
    """
    explicit = explicit_campaign_name_from_prompt(prompt)
    if explicit:
        return explicit

    if llm_fields and llm_fields.campaign_name:
        return llm_fields.campaign_name

    return emergency_campaign_name(
        prompt=prompt,
        campaign_type=campaign_type,
        geo_label=geo_label,
        final_url=final_url,
        business_context=business_context,
    )


def extract_google_campaign_fields_with_llm(
    *,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    workspace_id: str | None,
) -> GoogleCampaignFieldExtraction | None:
    """Parse Google campaign setup fields from conversation (any configured text LLM)."""
    from lib.planner.ads_llm import complete_ads_json_llm

    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    # When prompt is already full_conversation_text(), do not pass history again.
    convo = prompt if not conversation_history else _conversation_block(prompt, conversation_history)

    llm_prompt = f"""You map a user's natural-language ads request to Google Ads API parameters.

Today's date (UTC): {today}

Conversation:
{convo}

Your job: read ALL user messages together and infer intent — including typos, shorthand, and informal phrasing.
Examples:
- "Searh campaign", "serach", "Search" → campaign_type: "search"
- "8$", "$8/day", "93$", "8 dollars" → daily_budget as number
- "end after 2 days", "end until tomorrow", "run for a week", "until August 1" → end_date as YYYY-MM-DD
- "target Morocco", "in Casablanca", "Morocco except Casablanca" → geo_targeting with include/exclude locations
- "fitness supplements", "advertising setup for protein powder" → business_context
- any https:// URL → final_url
- Campaign types: search, display, video, shopping, performance_max, app, local (map user words to these)

Return JSON only:
{{
  "understood_summary": "1-2 friendly sentences acknowledging what you understood across the whole chat",
  "fields": {{
    "campaign_type": "search" | "display" | "video" | "shopping" | "performance_max" | "app" | "local" | null,
    "daily_budget": number | null,
    "start_date": "YYYY-MM-DD" | null,
    "end_date": "YYYY-MM-DD" | null,
    "final_url": "https://..." | null,
    "geo_countries": ["MA"] | null,
    "geo_targeting": {{
      "include": [{{"name": "Morocco", "type": "country"}}],
      "exclude": [{{"name": "Casablanca", "type": "city", "country_context": "MA"}}]
    }},
    "business_context": "what they sell/promote" | null,
    "campaign_name": "concise Google Ads campaign name" | null
  }}
}}

campaign_name rules:
- If the user explicitly names the campaign (quoted or "called X"), use their exact name.
- Otherwise invent a specific, professional name from brand/URL/business + campaign type + geo
  (e.g. "ProDiet Nutrition — Morocco & France Search", not "New campaign").
- Max 80 characters; include brand or geo so repeat runs do not collide on Google Ads.

Use null when unknown. Never invent budget, dates, or URLs. Infer typos and intent from context."""

    parsed = complete_ads_json_llm(
        workspace_id=workspace_id,
        prompt=llm_prompt,
        source='google_campaign_collection',
        temperature=0.15,
        max_tokens=500,
        opcode='plan_workflow',
    )
    if not parsed:
        return None
    return _sanitize_google_field_extraction(parsed)
