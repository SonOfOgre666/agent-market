"""Meta Ads targeting helpers — defaults only (no orchestration)."""

from __future__ import annotations

from typing import Any, Dict, Optional


def default_targeting(*, countries: Optional[list] = None) -> Dict[str, Any]:
    """Minimal US targeting with Advantage+ audience disabled (Meta API v24+)."""
    return {
        'age_min': 18,
        'age_max': 65,
        'geo_locations': {'countries': countries or ['US']},
        'targeting_automation': {'advantage_audience': 0},
    }


def resolve_targeting(
    custom: Optional[Dict[str, Any]] = None,
    *,
    countries: Optional[list] = None,
) -> Dict[str, Any]:
    """
    Use explicit ``targeting_spec`` / geo payload when provided, else defaults.
    Wizard fields like ``adset_name`` must be stripped by callers (see publish_defaults).
    """
    from .publish_defaults import strip_wizard_targeting_fields

    custom = strip_wizard_targeting_fields(custom)
    if not custom:
        return default_targeting(countries=countries)

    if custom.get('targeting_spec') and isinstance(custom['targeting_spec'], dict):
        spec = dict(custom['targeting_spec'])
        if 'targeting_automation' not in spec:
            spec['targeting_automation'] = {'advantage_audience': 0}
        return spec

    if custom.get('geo_locations') or custom.get('age_min') is not None:
        out = default_targeting(countries=countries)
        for key in ('age_min', 'age_max', 'geo_locations', 'targeting_automation', 'genders', 'flexible_spec'):
            if key in custom and custom[key] is not None:
                out[key] = custom[key]
        if 'targeting_automation' not in out:
            out['targeting_automation'] = {'advantage_audience': 0}
        return out

    return default_targeting(countries=countries)
