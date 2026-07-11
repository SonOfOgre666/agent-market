"""Parse JSON from LLM text responses."""

from __future__ import annotations

import json
import re
from typing import Any


def _extract_json_object(cleaned: str) -> Any | None:
    start = cleaned.find('{')
    end = cleaned.rfind('}')
    if start < 0 or end <= start:
        return None
    try:
        return json.loads(cleaned[start : end + 1])
    except Exception:
        return None


def parse_json_text(raw: str, fallback: Any) -> Any:
    if not raw:
        return fallback
    cleaned = raw.strip()
    if cleaned.startswith('```'):
        cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)
    try:
        return json.loads(cleaned)
    except Exception:
        extracted = _extract_json_object(cleaned)
        if extracted is not None:
            return extracted
        return fallback
