"""Normalize provider token usage metadata."""

from __future__ import annotations

from typing import Any


def empty_usage() -> dict[str, int | None]:
    return {
        'input_tokens': None,
        'output_tokens': None,
        'total_tokens': None,
    }


def from_openai_response(resp: Any) -> dict[str, int | None]:
    usage = getattr(resp, 'usage', None)
    if not usage:
        return empty_usage()
    inp = getattr(usage, 'prompt_tokens', None)
    out = getattr(usage, 'completion_tokens', None)
    tot = getattr(usage, 'total_tokens', None)
    return {
        'input_tokens': _int(inp),
        'output_tokens': _int(out),
        'total_tokens': _int(tot),
    }


def from_anthropic_message(msg: Any) -> dict[str, int | None]:
    usage = getattr(msg, 'usage', None)
    if not usage:
        return empty_usage()
    inp = getattr(usage, 'input_tokens', None)
    out = getattr(usage, 'output_tokens', None)
    tot = None
    if inp is not None or out is not None:
        tot = (inp or 0) + (out or 0)
    return {
        'input_tokens': _int(inp),
        'output_tokens': _int(out),
        'total_tokens': _int(tot),
    }


def from_gemini_response(data: dict[str, Any]) -> dict[str, int | None]:
    um = data.get('usageMetadata') or {}
    inp = um.get('promptTokenCount')
    out = um.get('candidatesTokenCount')
    tot = um.get('totalTokenCount')
    if tot is None and inp is not None and out is not None:
        tot = (inp or 0) + (out or 0)
    return {
        'input_tokens': _int(inp),
        'output_tokens': _int(out),
        'total_tokens': _int(tot),
    }


def _int(v: Any) -> int | None:
    if v is None:
        return None
    try:
        n = int(v)
        return n if n >= 0 else None
    except (TypeError, ValueError):
        return None
