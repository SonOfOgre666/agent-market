"""Normalize ad copy fields for Meta create_ad_creative (reference mutual-exclusion rules)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split('\n') if part.strip()]
    out: List[str] = []
    for item in value:
        if item is None:
            continue
        s = str(item).strip()
        if s:
            out.append(s)
    return out


def normalize_creative_copy(
    *,
    message: Optional[Any] = None,
    messages: Optional[Any] = None,
    headline: Optional[Any] = None,
    headlines: Optional[Any] = None,
    description: Optional[Any] = None,
    descriptions: Optional[Any] = None,
) -> Dict[str, Any]:
    """
    Meta rejects both singular and plural copy params (reference_ads/meta_ads/ads.py).

    - One variant → use message / headline / description
    - Multiple → use messages / headlines / descriptions
    """
    msg_list = _as_list(messages)
    hl_list = _as_list(headlines)
    desc_list = _as_list(descriptions)

    if headline and str(headline).strip():
        h = str(headline).strip()
        if not hl_list:
            hl_list = [h]
        elif len(hl_list) == 1 and hl_list[0] == h:
            pass
        elif h not in hl_list:
            hl_list = [h, *hl_list]

    if description and str(description).strip():
        d = str(description).strip()
        if not desc_list:
            desc_list = [d]
        elif len(desc_list) == 1 and desc_list[0] == d:
            pass
        elif d not in desc_list:
            desc_list = [d, *desc_list]

    out: Dict[str, Any] = {}

    if msg_list:
        if len(msg_list) > 1:
            out['messages'] = msg_list
        elif not message:
            out['message'] = msg_list[0]
        else:
            out['message'] = str(message).strip()
    elif message and str(message).strip():
        out['message'] = str(message).strip()

    if len(hl_list) > 1:
        out['headlines'] = hl_list
    elif len(hl_list) == 1:
        out['headline'] = hl_list[0]

    if len(desc_list) > 1:
        out['descriptions'] = desc_list
    elif len(desc_list) == 1:
        out['description'] = desc_list[0]

    return out
