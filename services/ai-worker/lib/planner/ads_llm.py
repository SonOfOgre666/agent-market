"""
Ads intelligence LLM routing — uses whatever text provider the workspace configured.

Settings → AI features (Google Ads Marketing, Marketing Assistant, Meta Ad Marketing).
Tries each distinct provider+model until one succeeds — not Gemini-specific.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# Preference order for Google/Meta campaign understanding (name, geo, fields, keywords).
ADS_INTELLIGENCE_FEATURES = (
    'google_search_marketing',
    'planner',
    'meta_ad_marketing',
)


def list_ads_llm_configs(workspace_id: str | None) -> list[dict[str, Any]]:
    """Distinct workspace LLM assignments with a connected integration (Settings → AI)."""
    from lib.ai_provider_config import is_text_provider_configured
    from lib.ai_workspace_config import get_ads_marketing_config, get_planner_config

    out: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()

    for fid in ADS_INTELLIGENCE_FEATURES:
        try:
            if fid == 'planner':
                row = {**get_planner_config(workspace_id), 'feature_id': 'planner'}
            else:
                row = get_ads_marketing_config(workspace_id, fid)
            provider = str(row.get('provider') or '').lower()
            model = str(row.get('model') or '')
            if not provider or not model:
                continue
            if not is_text_provider_configured(provider, workspace_id):
                continue
            key = (provider, model)
            if key in seen:
                continue
            seen.add(key)
            out.append(row)
        except Exception as exc:
            logger.debug('ads_llm skip feature %s: %s', fid, exc)
    return out


def complete_ads_text_llm(
    *,
    workspace_id: str | None,
    prompt: str,
    source: str,
    temperature: float = 0.2,
    max_tokens: int = 2048,
    opcode: str | None = None,
) -> str | None:
    """Call the first configured text provider that succeeds (OpenAI, Anthropic, Gemini, …)."""
    try:
        from lib.llm import text as text_llm
    except Exception:
        return None

    configs = list_ads_llm_configs(workspace_id)
    if not configs:
        logger.warning('%s: no ads LLM configured (%s)', source, 'Settings → AI')
        return None

    last_err: str | None = None
    for cfg in configs:
        provider = cfg['provider']
        model = cfg['model']
        feature_id = cfg.get('feature_id') or 'planner'
        try:
            return text_llm.complete(
                provider,
                model,
                prompt,
                workspace_id=workspace_id,
                temperature=temperature,
                max_tokens=max_tokens,
                api_model_id=cfg.get('api_model_id'),
                feature_id=feature_id,
                opcode=opcode or feature_id,
                source=source,
                record_usage=True,
            )
        except Exception as exc:
            last_err = str(exc)
            logger.warning(
                '%s LLM failed (%s/%s): %s',
                source,
                provider,
                model,
                exc,
            )
    if last_err:
        logger.warning('%s: all configured ads LLMs failed; last error: %s', source, last_err)
    return None


def complete_ads_json_llm(
    *,
    workspace_id: str | None,
    prompt: str,
    source: str,
    temperature: float = 0.2,
    max_tokens: int = 500,
    opcode: str | None = None,
) -> dict[str, Any] | None:
    """Parse JSON from the first ads LLM that returns a JSON object."""
    try:
        from lib.llm.json_utils import parse_json_text
    except Exception:
        return None

    raw = complete_ads_text_llm(
        workspace_id=workspace_id,
        prompt=prompt,
        source=source,
        temperature=temperature,
        max_tokens=max_tokens,
        opcode=opcode,
    )
    if not raw:
        return None
    parsed = parse_json_text(raw, {})
    return parsed if isinstance(parsed, dict) else None
