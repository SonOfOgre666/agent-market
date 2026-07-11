"""
Marketing Assistant dialogue — all user-facing messages come from the model.

Workflow specs supply facts and missing-parameter lists (source of truth).
Deterministic fallbacks exist only when the model is unavailable.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Literal

from lib.planner.workflow_collect import MissingParameter

logger = logging.getLogger(__name__)

DialoguePhase = Literal['collect', 'review', 'acknowledge', 'success', 'error']

# ISO → readable name so dialogue LLM does not confuse MA (Morocco) with Massachusetts.
_ISO_DISPLAY: dict[str, str] = {
    'MA': 'Morocco',
    'US': 'United States',
    'GB': 'United Kingdom',
    'FR': 'France',
    'DE': 'Germany',
    'ES': 'Spain',
    'IT': 'Italy',
    'CA': 'Canada',
    'AU': 'Australia',
    'MX': 'Mexico',
    'BR': 'Brazil',
    'IN': 'India',
    'SA': 'Saudi Arabia',
    'AE': 'United Arab Emirates',
    'EG': 'Egypt',
    'TR': 'Turkey',
    'NL': 'Netherlands',
    'BE': 'Belgium',
    'PT': 'Portugal',
}


def format_geo_display(
    geo_countries: list[str] | None,
    geo_query: str | None = None,
) -> str | None:
    if geo_query:
        return geo_query.strip()
    if not geo_countries:
        return None
    parts: list[str] = []
    for iso in geo_countries:
        code = str(iso or '').strip().upper()
        if not code:
            continue
        name = _ISO_DISPLAY.get(code)
        parts.append(f'{name} ({code})' if name else code)
    return ', '.join(parts) if parts else None


def enrich_facts_for_dialogue(facts: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize geo fields so the dialogue model uses country names, not bare ISO codes."""
    if not facts:
        return {}
    out = dict(facts)
    geo = out.get('geo') or out.get('geo_countries')
    geo_query = out.get('geo_query')
    locations = format_geo_display(
        geo if isinstance(geo, list) else ([geo] if geo else None),
        str(geo_query) if geo_query else None,
    )
    if locations:
        out['locations'] = locations
        out.pop('geo', None)
        if 'geo_countries' in out and out.get('geo_countries') != locations:
            out['geo_countries'] = locations
    return out


def _planner_config(workspace_id: str | None):
    try:
        from lib.ai_workspace_config import get_planner_config

        return get_planner_config(workspace_id)
    except Exception:
        return None


def _format_missing(missing: list[str] | list[MissingParameter] | None) -> str:
    if not missing:
        return ''
    lines: list[str] = []
    for i, item in enumerate(missing, 1):
        if isinstance(item, MissingParameter):
            lines.append(f'{i}. {item.label} — {item.hint}')
        else:
            lines.append(f'{i}. {str(item).lstrip("• ").strip()}')
    return '\n\n' + '\n'.join(lines)


def _format_missing_block(missing: list[str] | list[MissingParameter] | None) -> str:
    block = _format_missing(missing)
    return f'\nStill needed:{block}' if block else ''


def _minimal_fallback(
    phase: DialoguePhase,
    *,
    workflow_label: str,
    facts: dict[str, Any] | None = None,
    missing: list[str] | list[MissingParameter] | None = None,
    error: str | None = None,
    extra_instructions: str = '',
) -> str:
    if phase == 'error' and error:
        return error
    if phase == 'collect' and missing:
        msg = f'To continue with {workflow_label}, I still need:{_format_missing(missing)}'
        if extra_instructions:
            msg = f'{msg}\n\n{extra_instructions}'
        return msg
    if phase == 'review':
        lines = [f'Review — {workflow_label}']
        f = facts or {}
        for key, label in (
            ('campaign_type', 'Campaign type'),
            ('objective', 'Objective'),
            ('daily_budget', 'Daily budget'),
            ('end_date', 'End date'),
            ('end_time', 'End date'),
            ('locations', 'Locations'),
            ('geo_countries', 'Countries'),
            ('final_url', 'Final URL'),
            ('link_url', 'Destination URL'),
            ('status', 'Status'),
        ):
            val = f.get(key)
            if val is not None and val != '':
                lines.append(f'{label}: {val}')
        keywords = f.get('keywords') or []
        if keywords:
            lines.append(f'Generated keywords: {", ".join(str(k) for k in keywords[:12])}')
        headlines = f.get('headlines') or []
        if headlines:
            lines.append(f'Headlines: {", ".join(str(h) for h in headlines[:5])}')
        if f.get('estimated_max_spend') is not None:
            lines.append(f'Estimated max spend: ${f["estimated_max_spend"]:.0f}')
        lines.append('Type APPROVE to continue.')
        if keywords:
            lines.append('You can REMOVE <keyword> or ADD <keyword> to edit generated keywords.')
        return '\n'.join(lines)
    if phase == 'success':
        detail = (facts or {}).get('success_detail') or ''
        base = f'Done — your {workflow_label} request has been processed.'
        return f'{base} {detail}'.strip() if detail else base
    return f'Got it — working on your {workflow_label} request.'


def render_agent_message(
    *,
    workspace_id: str | None,
    phase: DialoguePhase,
    workflow_label: str,
    facts: dict[str, Any] | None = None,
    missing: list[str] | list[MissingParameter] | None = None,
    error: str | None = None,
    success_detail: str | None = None,
    extra_instructions: str = '',
    use_llm: bool = True,
) -> str:
    """Generate the assistant reply for this workflow turn."""
    cfg = _planner_config(workspace_id) if use_llm else None
    fallback = _minimal_fallback(
        phase,
        workflow_label=workflow_label,
        facts=facts,
        missing=missing,
        error=error,
        extra_instructions=extra_instructions,
    )
    if not cfg:
        if phase == 'success' and success_detail:
            return _minimal_fallback(
                phase,
                workflow_label=workflow_label,
                facts={**(facts or {}), 'success_detail': success_detail},
            )
        return fallback

    facts_json = json.dumps(enrich_facts_for_dialogue(facts), indent=2, default=str)
    missing_block = _format_missing_block(missing)

    phase_tasks = {
        'collect': (
            'You are a marketing assistant collecting missing information before running any tools. '
            'Acknowledge what you already understand from the conversation, then ask ONLY for what is still missing. '
            'Be natural and concise — not a rigid form or bullet template. '
            'When campaign type is missing, always list every Google option with a short description: '
            'Search (text ads on Google Search), Display (image ads on websites), Video (YouTube ads), '
            'Shopping (product listings via Merchant Center), Performance Max (automated multi-channel), '
            'App (mobile app installs), Local (local business / store visits). '
            'Include the hint text for each missing field exactly as provided below.'
        ),
        'review': (
            'Present a pre-execution review. Facts below are validated — include them accurately. '
            'Ask the user to type APPROVE to continue. Do not invent or change numbers, URLs, or dates.'
        ),
        'acknowledge': (
            'Briefly acknowledge what you understood from the user in a friendly, conversational way.'
        ),
        'success': (
            'Tell the user their request completed successfully. Summarize what was done using the facts below.'
        ),
        'error': (
            'Explain clearly why the request cannot proceed yet. Be helpful — suggest what the user can fix.'
        ),
    }
    task = phase_tasks.get(phase, phase_tasks['acknowledge'])

    llm_prompt = f"""{task}

Workflow: {workflow_label}
Phase: {phase}

Validated facts:
{facts_json}
{missing_block}
{f"Error context: {error}" if error else ""}
{f"Success detail: {success_detail}" if success_detail else ""}

Rules:
- Plain text only (no JSON)
- Do not use the bullet character "•"
- Never default budget, dates, or URLs
- Country codes in facts use ISO — MA is Morocco, not Massachusetts
- Do not claim live publish unless phase is success
{extra_instructions}

Write the assistant message:"""

    try:
        from lib.llm import text as text_llm

        text = text_llm.complete(
            cfg['provider'],
            cfg['model'],
            llm_prompt,
            workspace_id=workspace_id,
            temperature=0.45,
            max_tokens=750,
            api_model_id=cfg.get('api_model_id'),
            feature_id='planner',
            opcode='plan_workflow',
            source=f'agent_dialogue_{phase}',
            record_usage=True,
        )
        cleaned = (text or '').strip()
        if cleaned:
            return cleaned
    except Exception as exc:
        logger.warning('agent_dialogue %s failed: %s', phase, exc)

    return fallback


# Back-compat wrappers
def render_planner_dialogue(
    *,
    workspace_id: str | None,
    phase: DialoguePhase,
    title: str,
    facts: dict[str, Any],
    missing: list[str] | None = None,
    extra_instructions: str = '',
    fallback_text: str,
) -> str:
    msg = render_agent_message(
        workspace_id=workspace_id,
        phase=phase,
        workflow_label=title,
        facts=facts,
        missing=missing,
        extra_instructions=extra_instructions,
    )
    if msg == _minimal_fallback(
        phase,
        workflow_label=title,
        facts=facts,
        missing=missing,
        extra_instructions=extra_instructions,
    ):
        return fallback_text
    return msg


def compiled_google_facts(compiled: Any) -> dict[str, Any]:
    geo_countries = getattr(compiled, 'geo_countries', None)
    geo_query = getattr(compiled, 'geo_query', None)
    geo_intent = getattr(compiled, 'geo_intent', None)
    locations = (
        geo_intent.display_label()
        if geo_intent and geo_intent.display_label()
        else format_geo_display(geo_countries, geo_query)
    )
    return {
        'campaign_type': getattr(compiled, 'campaign_type', None),
        'daily_budget': getattr(compiled, 'budget_amount', None),
        'end_date': getattr(compiled, 'end_date', None),
        'start_date': getattr(compiled, 'start_date', None),
        'locations': locations,
        'final_url': getattr(compiled, 'final_url', None),
        'status': getattr(compiled, 'status', None),
        'business_context': getattr(compiled, 'business_context', None),
        'keywords': (getattr(compiled, 'keywords', None) or [])[:12],
        'headlines': (getattr(compiled, 'headlines', None) or [])[:5],
        'descriptions': (getattr(compiled, 'descriptions', None) or [])[:3],
        'estimated_max_spend': getattr(compiled, 'estimated_max_spend', None),
    }


def compiled_meta_facts(compiled: Any) -> dict[str, Any]:
    geo_countries = getattr(compiled, 'geo_countries', None)
    geo_intent = getattr(compiled, 'geo_intent', None)
    locations = (
        geo_intent.display_label()
        if geo_intent and geo_intent.display_label()
        else format_geo_display(geo_countries)
    )
    return {
        'objective': getattr(compiled, 'objective', None),
        'daily_budget': getattr(compiled, 'budget_amount', None),
        'end_time': getattr(compiled, 'end_time', None),
        'start_time': getattr(compiled, 'start_time', None),
        'locations': locations,
        'pages': getattr(compiled, 'page_names', None) or getattr(compiled, 'page_ids', None),
        'link_url': getattr(compiled, 'link_url', None),
        'status': getattr(compiled, 'status', None),
        'message': getattr(compiled, 'message', None),
        'headline': getattr(compiled, 'headline', None),
        'description': getattr(compiled, 'description', None),
        'estimated_max_spend': getattr(compiled, 'estimated_max_spend', None),
    }
