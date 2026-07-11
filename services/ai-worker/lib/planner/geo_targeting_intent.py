"""
Dynamic geo targeting intent — LLM extracts include/exclude locations from conversation.

Platforms resolve names to API IDs at execution time via geo search tools (MCP-style:
understand in chat → call search/resolve tools → publish).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

logger = logging.getLogger(__name__)

GeoRole = Literal['include', 'exclude']
GeoLocationType = Literal['country', 'region', 'state', 'city', 'metro', 'zip', 'auto']

_VALID_TYPES = frozenset({'country', 'region', 'state', 'city', 'metro', 'zip', 'auto'})

_EXCLUDE_RE = re.compile(
    r'\b(?:except|excluding|exclude|but not|without|outside)\b',
    re.I,
)

_GEO_NOISE_RE = re.compile(
    r'\b(?:google\s+ads?|meta\s+ads?|facebook\s+ads?|display|search|video|shopping|'
    r'performance\s+max|campaign|approve|paused?|make\s+it|just|end\s+after|per\s+day|'
    r'daily\s+budget|https?)\b',
    re.I,
)
_GEO_TRAILING_JUNK_RE = re.compile(
    r'\s+(?:display|search|video|make|just|\$?\d+(?:\.\d+)?(?:/day)?).*$',
    re.I,
)


@dataclass
class GeoLocationSpec:
    name: str
    role: GeoRole = 'include'
    location_type: GeoLocationType = 'auto'
    country_context: str | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            'name': self.name,
            'role': self.role,
            'type': self.location_type,
        }
        if self.country_context:
            out['country_context'] = self.country_context
        return out

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> GeoLocationSpec | None:
        name = str(raw.get('name') or '').strip()
        if not name:
            return None
        role = str(raw.get('role') or 'include').strip().lower()
        if role not in ('include', 'exclude'):
            role = 'include'
        loc_type = str(raw.get('type') or raw.get('location_type') or 'auto').strip().lower()
        if loc_type not in _VALID_TYPES:
            loc_type = 'auto'
        ctx = str(raw.get('country_context') or raw.get('country') or '').strip().upper() or None
        if ctx and len(ctx) != 2:
            ctx = None
        spec = GeoLocationSpec(name=name, role=role, location_type=loc_type, country_context=ctx)  # type: ignore[arg-type]
        return normalize_geo_location_spec(spec)


_KNOWN_CITY_SPECS: dict[str, GeoLocationSpec] = {
    'marrakech': GeoLocationSpec(name='Marrakech', location_type='city', role='include', country_context='MA'),
    'marrakesh': GeoLocationSpec(name='Marrakech', location_type='city', role='include', country_context='MA'),
    'casablanca': GeoLocationSpec(name='Casablanca', location_type='city', role='include', country_context='MA'),
    'rabat': GeoLocationSpec(name='Rabat', location_type='city', role='include', country_context='MA'),
    'fes': GeoLocationSpec(name='Fes', location_type='city', role='include', country_context='MA'),
    'fez': GeoLocationSpec(name='Fes', location_type='city', role='include', country_context='MA'),
    'tangier': GeoLocationSpec(name='Tangier', location_type='city', role='include', country_context='MA'),
}


def sanitize_geo_location_name(raw: str) -> str:
    """Strip campaign/budget noise accidentally captured as a place name."""
    s = re.sub(r'\s+', ' ', (raw or '').strip())
    if not s:
        return ''
    s = _GEO_TRAILING_JUNK_RE.sub('', s)
    s = _GEO_NOISE_RE.sub(' ', s)
    s = re.sub(r'\s+', ' ', s).strip(' ,.-')
    words = [w for w in s.split() if w and not re.fullmatch(r'\$?\d+(?:\.\d+)?', w)]
    if len(words) > 4:
        words = words[:4]
    return ' '.join(words)


def normalize_geo_location_spec(spec: GeoLocationSpec) -> GeoLocationSpec:
    """Clean polluted names and map well-known cities to disambiguated specs."""
    clean = sanitize_geo_location_name(spec.name)
    if not clean:
        clean = (spec.name or '').strip()
    key = clean.lower()
    if key in _KNOWN_CITY_SPECS:
        base = _KNOWN_CITY_SPECS[key]
        return GeoLocationSpec(
            name=base.name,
            role=spec.role,
            location_type=base.location_type,
            country_context=base.country_context,
        )
    if 'morocco' in key:
        return GeoLocationSpec(
            name='Morocco',
            role=spec.role,
            location_type='country',
            country_context='MA',
        )
    title = clean.title() if clean.islower() else clean
    return GeoLocationSpec(
        name=title,
        role=spec.role,
        location_type=spec.location_type,
        country_context=spec.country_context,
    )


@dataclass
class GeoTargetingIntent:
    include: list[GeoLocationSpec] = field(default_factory=list)
    exclude: list[GeoLocationSpec] = field(default_factory=list)
    summary: str = ''

    def has_locations(self) -> bool:
        return bool(self.include or self.exclude)

    def country_codes(self) -> list[str]:
        """ISO codes mentioned on country-level includes (for keyword/audience hints)."""
        codes: list[str] = []
        for loc in self.include:
            if loc.location_type == 'country' and len(loc.name) == 2:
                code = loc.name.upper()
                if code not in codes:
                    codes.append(code)
            elif loc.country_context and loc.country_context not in codes:
                codes.append(loc.country_context)
        return codes

    def display_label(self) -> str:
        parts: list[str] = []
        if self.include:
            parts.append(', '.join(x.name for x in self.include))
        if self.exclude:
            parts.append('excluding ' + ', '.join(x.name for x in self.exclude))
        if parts:
            return ' '.join(parts)
        if self.summary:
            return sanitize_geo_location_name(self.summary) or self.summary
        return ''

    def to_payload(self) -> dict[str, Any]:
        return {
            'include': [x.to_dict() for x in self.include],
            'exclude': [x.to_dict() for x in self.exclude],
            'summary': self.summary,
        }

    @classmethod
    def from_llm_fields(cls, fields: dict[str, Any] | None) -> GeoTargetingIntent | None:
        if not isinstance(fields, dict):
            return None
        raw = fields.get('geo_targeting')
        if not isinstance(raw, dict):
            return _intent_from_geo_countries(fields.get('geo_countries'))
        return _parse_geo_targeting_block(raw)

    @classmethod
    def from_payload(cls, payload: dict[str, Any] | None) -> GeoTargetingIntent | None:
        if not isinstance(payload, dict):
            return None
        include: list[GeoLocationSpec] = []
        exclude: list[GeoLocationSpec] = []
        for block, bucket in (('include', include), ('exclude', exclude)):
            raw_list = payload.get(block)
            if not isinstance(raw_list, list):
                continue
            seen: set[str] = set()
            for item in raw_list:
                if not isinstance(item, dict):
                    continue
                spec = GeoLocationSpec.from_dict(item)
                if spec and spec.name.lower() not in seen:
                    seen.add(spec.name.lower())
                    bucket.append(spec)
        summary = str(payload.get('summary') or '').strip()
        if not include and not exclude:
            return None
        return cls(include=include, exclude=exclude, summary=summary)


def restore_geo_intent(raw: Any) -> GeoTargetingIntent | None:
    """Rehydrate geo_intent after graph JSON round-trip (asdict / Mongo)."""
    if isinstance(raw, GeoTargetingIntent):
        return raw
    if isinstance(raw, dict):
        return GeoTargetingIntent.from_payload(raw)
    return None


def _parse_geo_targeting_block(raw: dict[str, Any]) -> GeoTargetingIntent | None:
    include: list[GeoLocationSpec] = []
    exclude: list[GeoLocationSpec] = []
    for item in raw.get('include') or []:
        if isinstance(item, dict):
            spec = GeoLocationSpec.from_dict({**item, 'role': 'include'})
            if spec:
                include.append(spec)
    for item in raw.get('exclude') or []:
        if isinstance(item, dict):
            spec = GeoLocationSpec.from_dict({**item, 'role': 'exclude'})
            if spec:
                exclude.append(spec)
    summary = str(raw.get('summary') or '').strip()
    if not include and not exclude:
        return None
    return GeoTargetingIntent(include=include, exclude=exclude, summary=summary)


def _country_spec_for_iso(iso: str) -> GeoLocationSpec:
    from lib.google_geo_targets import country_label_for_iso

    code = iso.strip().upper()
    return GeoLocationSpec(
        name=country_label_for_iso(code) or code,
        location_type='country',
        role='include',
        country_context=code,
    )


def _intent_from_geo_countries(raw_geo: Any) -> GeoTargetingIntent | None:
    codes: list[str] = []
    if isinstance(raw_geo, list):
        codes = [str(c).strip().upper() for c in raw_geo if str(c).strip()]
    elif isinstance(raw_geo, str) and raw_geo.strip():
        codes = [raw_geo.strip().upper()]
    if not codes:
        return None
    include = [_country_spec_for_iso(code) for code in codes]
    return GeoTargetingIntent(
        include=include,
        summary=', '.join(codes),
    )


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


def _planner_config(workspace_id: str | None):
    try:
        from lib.ai_workspace_config import get_planner_config

        return get_planner_config(workspace_id)
    except Exception:
        return None


_GEO_EXTRACTION_PROMPT = """You extract **location targeting intent** for digital ad campaigns from conversation.

Read ALL user messages. Infer countries, states/regions, cities, metros, and zip codes.
Support **multiple include locations** and **exclusions** (e.g. whole country except specific cities).

Examples:
- "target Morocco, France and Spain" → include 3 countries
- "Morocco but exclude Casablanca" → include Morocco (country), exclude Casablanca (city, country_context MA)
- "US nationwide except California and New York" → include United States, exclude California and New York (state)
- "Casablanca and Rabat only" → include both cities (country_context MA if Morocco implied)
- "run ads in California and Texas" → include both US states
- "MA, FR" → include Morocco and France as countries

For each location:
- name: human place name as user meant it (not API id)
- type: country | region | state | city | metro | zip | auto
- country_context: ISO-3166 alpha-2 when needed to disambiguate (e.g. Paris FR vs Paris TX)
- role: include or exclude

Return JSON only:
{{
  "summary": "short human-readable targeting summary",
  "geo_targeting": {{
    "include": [
      {{"name": "Morocco", "type": "country", "country_context": null}}
    ],
    "exclude": [
      {{"name": "Casablanca", "type": "city", "country_context": "MA"}}
    ]
  }}
}}

Use empty arrays when none. Never invent locations the user did not mention."""


def extract_geo_targeting_intent(
    *,
    prompt: str,
    conversation_history: list[dict[str, Any]] | None = None,
    workspace_id: str | None = None,
    llm_geo_fields: dict[str, Any] | None = None,
) -> GeoTargetingIntent | None:
    """
    LLM-first geo intent. Falls back to legacy country resolution when model unavailable.
    """
    if llm_geo_fields:
        intent = GeoTargetingIntent.from_llm_fields(llm_geo_fields)
        if intent and intent.has_locations():
            return intent

    from lib.planner.ads_llm import complete_ads_json_llm, list_ads_llm_configs

    if list_ads_llm_configs(workspace_id):
        try:
            convo = prompt if not conversation_history else _conversation_block(prompt, conversation_history)
            today = datetime.now(timezone.utc).strftime('%Y-%m-%d')
            llm_prompt = f"""Today's date (UTC): {today}

Conversation:
{convo}

{_GEO_EXTRACTION_PROMPT}"""
            parsed = complete_ads_json_llm(
                workspace_id=workspace_id,
                prompt=llm_prompt,
                source='geo_targeting_intent',
                temperature=0.1,
                max_tokens=500,
            )
            if isinstance(parsed, dict):
                block = parsed.get('geo_targeting') if isinstance(parsed.get('geo_targeting'), dict) else parsed
                intent = _parse_geo_targeting_block(block) if isinstance(block, dict) else None
                if intent:
                    if not intent.summary:
                        intent.summary = str(parsed.get('summary') or '').strip()
                    return intent
        except Exception as exc:
            logger.debug('geo intent LLM extraction failed: %s', exc)

    return _legacy_geo_intent(prompt, conversation_history)


def _legacy_geo_intent(
    prompt: str,
    conversation_history: list[dict[str, Any]] | None,
) -> GeoTargetingIntent | None:
    """Regex/alias fallback when LLM is unavailable."""
    from lib.planner.meta_campaign_spec import resolve_geo_countries

    full = prompt
    if conversation_history:
        parts = [str(m.get('content') or '') for m in conversation_history]
        parts.append(prompt or '')
        full = '\n'.join(p for p in parts if p)

    countries = resolve_geo_countries(full) or []
    if countries:
        include: list[GeoLocationSpec] = []
        exclude: list[GeoLocationSpec] = []
        for iso in countries:
            include.append(_country_spec_for_iso(iso))
        for match in re.finditer(
            r'\b(?:exclude|excluding|except|but not)\s+([A-Za-z][A-Za-z\-\s]{1,40}?)(?=\s*(?:,|\.|$|\band\b|\bor\b))',
            full or '',
            re.I,
        ):
            place = match.group(1).strip().rstrip(',.')
            if place and place.lower() not in ('the', 'a', 'an'):
                if any(x.name.lower() == place.lower() for x in exclude):
                    continue
                ctx = countries[0] if len(countries) == 1 else None
                exclude.append(
                    GeoLocationSpec(
                        name=place,
                        location_type='city',
                        role='exclude',
                        country_context=ctx,
                    )
                )
        summary = ', '.join(countries)
        if exclude:
            summary += ', excluding ' + ', '.join(x.name for x in exclude)
        return GeoTargetingIntent(include=include, exclude=exclude, summary=summary)

    # Known cities mentioned anywhere in the conversation (before free-text regex).
    full_lower = (full or '').lower()
    for key, city_spec in _KNOWN_CITY_SPECS.items():
        if re.search(rf'\b{re.escape(key)}\b', full_lower):
            spec = normalize_geo_location_spec(
                GeoLocationSpec(name=city_spec.name, location_type='city', role='include', country_context=city_spec.country_context),
            )
            return GeoTargetingIntent(include=[spec], summary=spec.name)

    # Single free-text location phrase
    m = re.search(
        r'\b(?:in|for|target(?:ing)?)\s+'
        r'([A-Za-z][A-Za-z\s,\-\']*?)'
        r'(?=\s+(?:google|meta)\s+ads|\s+display|\s+search|\s+\$|\d|\.|$|\n)',
        full or '',
        re.I,
    )
    if m:
        phrase = m.group(1).strip().rstrip(',')
        if phrase and phrase.lower() not in ('my', 'a', 'the', 'google', 'search', 'display'):
            return GeoTargetingIntent(
                include=[
                    normalize_geo_location_spec(
                        GeoLocationSpec(name=phrase, location_type='auto', role='include'),
                    ),
                ],
                summary=sanitize_geo_location_name(phrase) or phrase,
            )

    return None


def merge_geo_intent_with_llm_countries(
    intent: GeoTargetingIntent | None,
    geo_countries: list[str] | None,
) -> GeoTargetingIntent | None:
    """When campaign LLM returns geo_countries but no geo_targeting block, upgrade to intent."""
    if intent and intent.has_locations():
        return intent
    return GeoTargetingIntent.from_llm_fields({'geo_countries': geo_countries})
