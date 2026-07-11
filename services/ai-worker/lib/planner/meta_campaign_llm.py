"""
Meta campaign collection — planner LLM understands user replies and drafts clarifications.

Uses the same workspace agent model (Settings → AI → Marketing Assistant).
Rule-based validation in meta_campaign_spec remains the safety layer.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

CreativeFormat = Literal['image', 'video']

logger = logging.getLogger(__name__)

_VALID_OBJECTIVES = frozenset({
    'OUTCOME_TRAFFIC',
    'OUTCOME_AWARENESS',
    'OUTCOME_ENGAGEMENT',
    'OUTCOME_LEADS',
    'OUTCOME_SALES',
    'OUTCOME_APP_PROMOTION',
})


@dataclass
class PlannerCampaignExtraction:
    objective: str | None = None
    page_ids: list[str] = field(default_factory=list)
    daily_budget: float | None = None
    end_time: str | None = None
    geo_countries: list[str] | None = None
    link_url: str | None = None
    creative_format: CreativeFormat | None = None
    lead_form_id: str | None = None
    application_id: str | None = None
    store_url: str | None = None
    understood_summary: str = ''
    start_time: str | None = None


def _end_of_day_iso(y: int, mo: int, d: int) -> str:
    return datetime(y, mo, d, 23, 59, 59, tzinfo=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+0000')


def _start_of_day_iso(y: int, mo: int, d: int) -> str:
    return datetime(y, mo, d, 0, 0, 0, tzinfo=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S+0000')


def _normalize_end_time(raw: str | None) -> str | None:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if 'T' in text and re.match(r'20\d{2}-\d{2}-\d{2}T', text):
        return text
    m = re.match(r'^(20\d{2})-(\d{2})-(\d{2})$', text)
    if m:
        return _end_of_day_iso(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def _normalize_start_time(raw: str | None) -> str | None:
    if not raw:
        return None
    text = str(raw).strip()
    if not text:
        return None
    if 'T' in text and re.match(r'20\d{2}-\d{2}-\d{2}T', text):
        return text
    m = re.match(r'^(20\d{2})-(\d{2})-(\d{2})$', text)
    if m:
        return _start_of_day_iso(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def _conversation_block(
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
) -> str:
    lines: list[str] = []
    for msg in conversation_history or []:
        role = str(msg.get('role') or 'user')
        content = str(msg.get('content') or '').strip()
        if content:
            lines.append(f'{role}: {content}')
    current = (prompt or '').strip()
    if current and (not lines or not lines[-1].endswith(current)):
        lines.append(f'user: {current}')
    return '\n'.join(lines) if lines else current


def _pages_block(pages: list[dict[str, str]]) -> str:
    if not pages:
        return '(no Facebook Pages available)'
    rows = []
    for i, page in enumerate(pages, start=1):
        rows.append(f'{i}. {page["name"]} (ID: {page["id"]})')
    return '\n'.join(rows)


def _sanitize_extraction(
    parsed: dict[str, Any],
    *,
    pages: list[dict[str, str]],
) -> PlannerCampaignExtraction:
    fields = parsed.get('fields') if isinstance(parsed.get('fields'), dict) else parsed
    if not isinstance(fields, dict):
        fields = {}

    known_page_ids = {p['id'] for p in pages}
    page_ids: list[str] = []
    for raw in fields.get('page_ids') or []:
        pid = str(raw).strip()
        if pid in known_page_ids and pid not in page_ids:
            page_ids.append(pid)

    objective = str(fields.get('objective') or '').strip().upper() or None
    if objective not in _VALID_OBJECTIVES:
        objective = None

    budget_raw = fields.get('daily_budget')
    daily_budget: float | None = None
    if budget_raw is not None:
        try:
            amount = float(budget_raw)
            if amount >= 1:
                daily_budget = amount
        except (TypeError, ValueError):
            pass

    geo: list[str] | None = None
    raw_geo = fields.get('geo_countries')
    if isinstance(raw_geo, list):
        codes = [str(c).strip().upper() for c in raw_geo if str(c).strip()]
        if codes:
            geo = codes
    raw_gt = fields.get('geo_targeting')
    if isinstance(raw_gt, dict):
        from lib.planner.geo_targeting_intent import GeoTargetingIntent
        intent = GeoTargetingIntent.from_llm_fields({'geo_targeting': raw_gt})
        if intent and intent.country_codes():
            geo = intent.country_codes()

    fmt = str(fields.get('creative_format') or '').strip().lower()
    creative_format: CreativeFormat | None = None
    if fmt in ('image', 'video'):
        creative_format = fmt  # type: ignore[assignment]

    link = str(fields.get('link_url') or '').strip() or None
    if link and not link.startswith('http'):
        link = None

    lead_form = str(fields.get('lead_form_id') or '').strip() or None
    app_id = str(fields.get('application_id') or '').strip() or None
    store_url = str(fields.get('store_url') or '').strip() or None

    summary = str(parsed.get('understood_summary') or fields.get('understood_summary') or '').strip()

    return PlannerCampaignExtraction(
        objective=objective,
        page_ids=page_ids,
        daily_budget=daily_budget,
        end_time=_normalize_end_time(fields.get('end_date') or fields.get('end_time')),
        geo_countries=geo,
        link_url=link,
        creative_format=creative_format,
        lead_form_id=lead_form,
        application_id=app_id,
        store_url=store_url,
        understood_summary=summary,
        start_time=_normalize_start_time(fields.get('start_date') or fields.get('start_time')),
    )


def extract_with_planner_llm(
    *,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    pages: list[dict[str, str]],
    workspace_id: str | None,
) -> PlannerCampaignExtraction | None:
    """Parse user intent with the workspace planner model."""
    try:
        from lib.ai_workspace_config import get_planner_config
        from lib.llm import text as text_llm
        from lib.llm.json_utils import parse_json_text

        cfg = get_planner_config(workspace_id)
    except Exception:
        return None

    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    convo = prompt if not conversation_history else _conversation_block(prompt, conversation_history)

    llm_prompt = f"""You map a user's natural-language chat to Meta Ads API parameters.

Today's date (UTC): {today}

Available Facebook Pages (use exact IDs when the user picks a Page):
{_pages_block(pages)}

Conversation:
{convo}

Your job: read ALL user messages and map informal phrasing to structured fields.
Examples:
- "8$", "$9/day" → daily_budget
- "end after 2 days", "until Friday", "tomorrow" → end_date as YYYY-MM-DD
- "Traffic", "leads", "awareness" → objective (OUTCOME_* enum)
- Page names, "first page", ordinals → page_ids
- Morocco, Casablanca, "US except California" → geo_targeting with include/exclude
- https://... → link_url

Valid objectives (exact strings):
OUTCOME_TRAFFIC, OUTCOME_AWARENESS, OUTCOME_ENGAGEMENT, OUTCOME_LEADS, OUTCOME_SALES, OUTCOME_APP_PROMOTION

Return JSON only:
{{
  "understood_summary": "1-2 friendly sentences acknowledging what you understood across the whole chat",
  "fields": {{
    "objective": "OUTCOME_..." | null,
    "page_ids": ["..."],
    "daily_budget": number | null,
    "start_date": "YYYY-MM-DD" | null,
    "end_date": "YYYY-MM-DD" | null,
    "geo_countries": ["MA"],
    "geo_targeting": {{
      "include": [{{"name": "Morocco", "type": "country"}}],
      "exclude": []
    }},
    "link_url": "https://..." | null,
    "creative_format": "image" | "video" | null,
    "lead_form_id": null,
    "application_id": null,
    "store_url": null
  }}
}}

Use null when unknown. Never invent budget, geo, or URLs. Prefer mapping user intent over literal keywords."""

    try:
        raw = text_llm.complete(
            cfg['provider'],
            cfg['model'],
            llm_prompt,
            workspace_id=workspace_id,
            temperature=0.15,
            max_tokens=600,
            api_model_id=cfg.get('api_model_id'),
            feature_id='planner',
            opcode='plan_workflow',
            source='meta_campaign_collection',
            record_usage=True,
        )
        parsed = parse_json_text(raw, {})
        if not isinstance(parsed, dict):
            return None
        return _sanitize_extraction(parsed, pages=pages)
    except Exception as exc:
        logger.warning('meta_campaign_collection LLM failed: %s', exc)
        return None


def build_clarification_with_planner_llm(
    *,
    missing_lines: list[str],
    pages: list[dict[str, str]] | None,
    understood: dict[str, Any],
    workspace_id: str | None,
    has_image: bool,
) -> str | None:
    """Draft a user-friendly collection reply with the planner model."""
    if not missing_lines:
        return None
    try:
        from lib.ai_workspace_config import get_planner_config
        from lib.llm import text as text_llm

        cfg = get_planner_config(workspace_id)
    except Exception:
        return None

    understood_text = '\n'.join(f'- {k}: {v}' for k, v in understood.items() if v)
    missing_text = '\n'.join(f'- {line.lstrip("• ").strip()}' for line in missing_lines)
    pages_text = _pages_block(pages or [])

    llm_prompt = f"""You are helping collect details for a paused Meta Ads CBO campaign (campaign → ad set → upload → creative → ad).

Already understood from the user:
{understood_text or '(nothing yet)'}

Still needed:
{missing_text}

Facebook Pages on this account:
{pages_text}

Write a concise, friendly assistant message that:
1. Briefly acknowledges what we already have (if anything)
2. Clearly asks ONLY for the missing items (do not re-ask for fields already understood)
3. Keeps required Meta policy reminders: daily budget is never defaulted, end date required, public HTTPS shop URL for website/traffic ads, attach image or say image vs video
4. Does NOT use markdown bullet characters "•" — use plain lines or numbered lists
5. Does NOT promise the campaign is created yet — we are still collecting

Return plain text only, no JSON."""

    try:
        text = text_llm.complete(
            cfg['provider'],
            cfg['model'],
            llm_prompt,
            workspace_id=workspace_id,
            temperature=0.4,
            max_tokens=500,
            api_model_id=cfg.get('api_model_id'),
            feature_id='planner',
            opcode='plan_workflow',
            source='meta_campaign_clarification',
            record_usage=True,
        )
        cleaned = (text or '').strip()
        return cleaned or None
    except Exception as exc:
        logger.warning('meta_campaign_clarification LLM failed: %s', exc)
        return None


_META_PRIMARY_TEXT_MAX = 220
_META_HEADLINE_MAX = 40
_META_DESCRIPTION_MAX = 90

_GEO_QUERY_BY_ISO: dict[str, str] = {
    'MA': 'Morocco',
    'US': 'United States',
    'FR': 'France',
    'ES': 'Spain',
    'GB': 'United Kingdom',
    'DE': 'Germany',
    'CA': 'Canada',
}


def _truncate_meta(text: str, max_len: int) -> str:
    s = re.sub(r'\s+', ' ', (text or '').strip())
    if len(s) <= max_len:
        return s
    cut = s[:max_len].rsplit(' ', 1)[0]
    return cut or s[:max_len]


def _complete_json_llm(
    *,
    llm_prompt: str,
    workspace_id: str | None,
    source: str,
    max_tokens: int = 500,
) -> dict[str, Any] | None:
    try:
        from lib.llm import text as text_llm
        from lib.llm.json_utils import parse_json_text

        cfg = _meta_marketing_llm_config(workspace_id)
    except Exception:
        return None
    if not cfg:
        return None
    try:
        raw = text_llm.complete(
            cfg['provider'],
            cfg['model'],
            llm_prompt,
            workspace_id=workspace_id,
            temperature=0.25,
            max_tokens=max_tokens,
            api_model_id=cfg.get('api_model_id'),
            feature_id=cfg.get('feature_id'),
            opcode='meta_ad_marketing',
            source=source,
            record_usage=True,
        )
        parsed = parse_json_text(raw, {})
        return parsed if isinstance(parsed, dict) else None
    except Exception as exc:
        logger.warning('%s LLM failed: %s', source, exc)
        return None


def _meta_marketing_llm_config(workspace_id: str | None):
    try:
        from lib.ai_workspace_config import get_ads_marketing_config

        return get_ads_marketing_config(workspace_id, 'meta_ad_marketing')
    except Exception:
        return None


def generate_meta_ad_copy_with_llm(
    *,
    campaign_name: str,
    objective: str,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    workspace_id: str | None,
    link_url: str | None = None,
) -> tuple[str, str, str] | None:
    """Generate Meta ad primary text, headline, and description."""
    convo = _conversation_block(prompt, conversation_history)
    llm_prompt = f"""You write Meta (Facebook/Instagram) ad copy.

Campaign name: {campaign_name}
Objective: {objective}
Landing page: {link_url or 'not provided'}

Conversation:
{convo}

Return JSON only:
{{
  "message": "primary text",
  "headline": "headline",
  "description": "link description or empty string"
}}

Rules:
- message max {_META_PRIMARY_TEXT_MAX} chars — compelling, specific to the user's business
- headline max {_META_HEADLINE_MAX} chars
- description max {_META_DESCRIPTION_MAX} chars (may be empty for awareness)
- Match the actual offer from the conversation — no generic fitness/travel/legal templates
- Align tone with objective (traffic/leads/sales/awareness)"""

    parsed = _complete_json_llm(
        llm_prompt=llm_prompt,
        workspace_id=workspace_id,
        source='meta_ad_copy',
        max_tokens=450,
    )
    if not parsed:
        return None

    message = _truncate_meta(str(parsed.get('message') or ''), _META_PRIMARY_TEXT_MAX)
    headline = _truncate_meta(str(parsed.get('headline') or ''), _META_HEADLINE_MAX)
    description = _truncate_meta(str(parsed.get('description') or ''), _META_DESCRIPTION_MAX)
    if not message or not headline:
        return None
    return message, headline, description


def emergency_meta_ad_copy(campaign_name: str, objective: str) -> tuple[str, str, str]:
    """Minimal non-vertical fallback when LLM is unavailable."""
    short = _truncate_meta(campaign_name or 'Our Business', _META_HEADLINE_MAX)
    if objective == 'OUTCOME_AWARENESS':
        return (
            _truncate_meta(f'Discover {short}.', _META_PRIMARY_TEXT_MAX),
            short,
            '',
        )
    if objective == 'OUTCOME_LEADS':
        return (
            'Get started today — we would love to hear from you.',
            short,
            'Sign up in seconds.',
        )
    return (
        _truncate_meta(f'Learn more about {short}.', _META_PRIMARY_TEXT_MAX),
        short,
        'See what we offer.',
    )


def resolve_meta_ad_copy(
    *,
    campaign_name: str,
    objective: str,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    workspace_id: str | None,
    link_url: str | None = None,
) -> tuple[str, str, str, str]:
    """Returns (message, headline, description, source) where source is llm or fallback."""
    generated = generate_meta_ad_copy_with_llm(
        campaign_name=campaign_name,
        objective=objective,
        prompt=prompt,
        conversation_history=conversation_history,
        workspace_id=workspace_id,
        link_url=link_url,
    )
    if generated:
        return *generated, 'llm'
    raise RuntimeError(
        'Meta ad copy generation failed. Configure Meta Ads Marketing AI under Settings → AI Integrations.'
    )


def infer_meta_strategy_queries_with_llm(
    *,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    workspace_id: str | None,
    geo_countries: list[str] | None,
) -> tuple[str, str] | None:
    """Return (geo_query, interest_query) for Meta audience research tools."""
    convo = _conversation_block(prompt, conversation_history)
    geo_label = ', '.join(geo_countries or []) or 'unspecified'
    llm_prompt = f"""You suggest Meta Ads audience research search queries.

Target countries (ISO): {geo_label}

Conversation:
{convo}

Return JSON only:
{{
  "geo_query": "country or region name for geo search (e.g. Morocco, United States)",
  "interest_query": "2-5 word interest phrase for Meta interest targeting search"
}}

Rules:
- geo_query must be a real place name matching the user's targeting
- interest_query must reflect the user's actual business/offer from the conversation
- No generic defaults like "fitness" unless the user is clearly in that vertical"""

    parsed = _complete_json_llm(
        llm_prompt=llm_prompt,
        workspace_id=workspace_id,
        source='meta_strategy_queries',
        max_tokens=200,
    )
    if not parsed:
        return None
    geo_q = str(parsed.get('geo_query') or '').strip()
    interest_q = str(parsed.get('interest_query') or '').strip()
    if not geo_q or not interest_q:
        return None
    return geo_q[:60], interest_q[:60]


def _fallback_strategy_queries(
    prompt: str,
    geo_countries: list[str] | None,
) -> tuple[str, str]:
    countries = geo_countries or ['US']
    geo_query = _GEO_QUERY_BY_ISO.get(str(countries[0]).upper(), 'United States')
    biz = re.search(
        r'\bfor my\s+(.+?)(?:\s+targeting|\s+in\s+[A-Za-z]|\s+\$|\s+until\b|$)',
        prompt or '',
        re.I,
    )
    if biz:
        interest_query = biz.group(1).strip().rstrip('.,')[:60]
    else:
        interest_query = re.sub(r'\s+', ' ', (prompt or '').strip())[:60] or 'business'
    return geo_query, interest_query


def resolve_meta_strategy_queries(
    *,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
    workspace_id: str | None,
    geo_countries: list[str] | None,
) -> tuple[str, str]:
    inferred = infer_meta_strategy_queries_with_llm(
        prompt=prompt,
        conversation_history=conversation_history,
        workspace_id=workspace_id,
        geo_countries=geo_countries,
    )
    if inferred:
        return inferred
    return _fallback_strategy_queries(prompt, geo_countries)
