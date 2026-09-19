"""Parse JSON-string tool payloads (MCP / LLM clients sometimes send dicts as strings)."""

from __future__ import annotations

import json
from typing import Any, List, Optional, TypeVar

T = TypeVar('T')


def coerce_json(value: Any, expected: type) -> Any:
    if value is None or isinstance(value, expected):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, expected):
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass
    return value


def coerce_optional_dict(value: Any) -> Optional[dict]:
    return coerce_json(value, dict)


def coerce_optional_list(value: Any) -> Optional[list]:
    return coerce_json(value, list)
