"""Provider-agnostic text completion — provider + model from workspace config."""

from __future__ import annotations

import httpx

from lib.ai_execution_log import record_execution
from lib.ai_provider_config import is_text_provider_configured, resolve_api_key, resolve_ollama_config
from lib.llm import ollama as ollama_llm
from lib.ai_workspace_config import OPCODE_TO_FEATURE
from lib.llm import anthropic as anthropic_llm
from lib.llm import openai as openai_llm
from lib.llm import openrouter as openrouter_llm
from lib.llm.gemini import complete_text as gemini_complete_text


def complete(
    provider: str,
    model: str,
    prompt: str,
    *,
    workspace_id: str | None = None,
    temperature: float = 0.85,
    max_tokens: int = 2048,
    api_model_id: str | None = None,
    feature_id: str | None = None,
    opcode: str | None = None,
    source: str | None = None,
    record_usage: bool = True,
    usage_out: dict | None = None,
    enable_reasoning: bool | None = None,
    json_mode: bool = False,
) -> str:
    p = (provider or '').strip().lower()
    if not p:
        raise RuntimeError('AI provider is not configured. Open Settings → AI.')

    resolved = (api_model_id or model or '').strip()
    if not resolved:
        raise RuntimeError('AI model is not configured. Open Settings → AI.')

    if not is_text_provider_configured(p, workspace_id):
        label = {
            'openai': 'OpenAI',
            'anthropic': 'Anthropic',
            'gemini': 'Gemini',
            'ollama': 'Ollama',
            'openrouter': 'OpenRouter',
        }.get(p, p)
        hint = 'server URL' if p == 'ollama' else 'API key'
        raise RuntimeError(f'{label} {hint} is not configured. Add it under Settings → AI.')

    catalog_model = (model or '').strip() or None
    fid = (feature_id or '').strip() or OPCODE_TO_FEATURE.get(opcode or '', '') or None

    import time

    t0 = time.perf_counter()
    status = 'success'
    err_msg: str | None = None
    usage: dict = {}
    text = ''

    try:
        if p == 'openai':
            text, usage = openai_llm.complete_text(
                api_key=resolve_api_key(p, workspace_id),
                model=resolved,
                prompt=prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        elif p == 'anthropic':
            text, usage = anthropic_llm.complete_text(
                api_key=resolve_api_key(p, workspace_id),
                model=resolved,
                prompt=prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        elif p == 'gemini':
            with httpx.Client() as client:
                text, usage = gemini_complete_text(
                    client,
                    prompt,
                    model=resolved,
                    workspace_id=workspace_id,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    json_mode=json_mode,
                )
        elif p == 'ollama':
            ollama_cfg = resolve_ollama_config(workspace_id)
            text, usage = ollama_llm.complete_text(
                base_url=ollama_cfg['base_url'],
                model=resolved,
                prompt=prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                api_key=ollama_cfg.get('api_key') or None,
            )
        elif p == 'openrouter':
            use_reasoning = enable_reasoning
            if use_reasoning is None:
                use_reasoning = (opcode or '') != 'planner' and (feature_id or '') != 'planner'
            text, usage = openrouter_llm.complete_text(
                api_key=resolve_api_key(p, workspace_id),
                model=resolved,
                prompt=prompt,
                temperature=temperature,
                max_tokens=max_tokens,
                reasoning=use_reasoning,
            )
        else:
            raise ValueError(f'Unknown text provider: {p}')
        return text
    except Exception as exc:
        status = 'failed'
        err_msg = str(exc)
        raise
    finally:
        if usage_out is not None:
            usage_out.clear()
            usage_out.update(usage)
        if record_usage:
            record_execution(
                workspace_id=workspace_id,
                provider=p,
                model=catalog_model,
                api_model_id=resolved,
                feature_id=fid,
                opcode=opcode,
                execution_type='text',
                input_tokens=usage.get('input_tokens'),
                output_tokens=usage.get('output_tokens'),
                total_tokens=usage.get('total_tokens'),
                duration_ms=int((time.perf_counter() - t0) * 1000),
                status=status,
                error=err_msg,
                source=source,
            )
