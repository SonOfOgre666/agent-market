"""Google Ads connector helpers."""

from __future__ import annotations

from typing import Any, Optional


def campaign_resource_name(customer_id: str, campaign_id: str) -> str:
    cid = ''.join(c for c in str(customer_id or '') if c.isdigit())
    camp = ''.join(c for c in str(campaign_id or '') if c.isdigit()) or str(campaign_id or '').strip()
    return f'customers/{cid}/campaigns/{camp}'


def ad_group_resource_name(customer_id: str, ad_group_id: str) -> str:
    cid = ''.join(c for c in str(customer_id or '') if c.isdigit())
    ag = ''.join(c for c in str(ad_group_id or '') if c.isdigit()) or str(ad_group_id or '').strip()
    return f'customers/{cid}/adGroups/{ag}'


def enum_name(value: Any) -> str:
    if value is None:
        return ''
    return str(getattr(value, 'name', None) or value)


def map_campaign_status(status: str) -> str:
    s = (status or '').upper()
    return {'ENABLED': 'active', 'PAUSED': 'paused', 'REMOVED': 'ended'}.get(s, 'draft')


def map_channel_type(channel: str) -> str:
    u = (channel or '').upper().replace('-', '_')
    return {
        'SEARCH': 'search',
        'DISPLAY': 'display',
        'SHOPPING': 'shopping',
        'VIDEO': 'video',
        'SMART': 'smart',
        'PERFORMANCE_MAX': 'performance_max',
        'PERFORMANCEMAX': 'performance_max',
        'LOCAL': 'local',
        'APP': 'app',
        'MULTI_CHANNEL': 'app',
    }.get(u, 'search')


def resolve_channel_sub_type(client: Any, subtype: str) -> Any:
    """Map subtype string to AdvertisingChannelSubTypeEnum member."""
    key = (subtype or '').strip().upper().replace('-', '_')
    return enum_value(client, 'AdvertisingChannelSubTypeEnum', key)


def resolve_channel_enum(client: Any, ctype: Optional[str]) -> Any:
    """Map wizard/API type string to AdvertisingChannelTypeEnum (reference tools_campaigns)."""
    mapped = map_channel_type(str(ctype or 'search'))
    key = mapped.upper()
    if key == 'APP':
        key = 'MULTI_CHANNEL'
    if key == 'PERFORMANCE_MAX':
        key = 'PERFORMANCE_MAX'
    return enum_value(client, 'AdvertisingChannelTypeEnum', key)


def client_enum(client: Any, enum_name: str) -> Any:
    """
    Return the enum class from ``client.enums``.

    With ``use_proto_plus=True`` (our default), ``client.enums.FooEnum`` is already the
    inner enum (e.g. ``AdvertisingChannelType``), not a wrapper with ``.FooEnum.Foo``.
    """
    wrapper = getattr(client.enums, enum_name)
    if hasattr(wrapper, '__members__'):
        return wrapper
    inner_key = enum_name[:-4] if enum_name.endswith('Enum') else enum_name
    return getattr(wrapper, inner_key, wrapper)


def enum_value(client: Any, enum_name: str, member: str) -> Any:
    """e.g. ``enum_value(client, 'AdvertisingChannelTypeEnum', 'SEARCH')``."""
    return getattr(client_enum(client, enum_name), (member or '').strip().upper())


def resolve_enum(enum_type: Any, value: str, param_name: str) -> Any:
    """Resolve a proto enum from a case-insensitive string (reference _resolve_enum)."""
    key = (value or '').strip().upper()
    try:
        return enum_type[key]
    except (KeyError, AttributeError, TypeError) as exc:
        members = [
            n for n in getattr(enum_type, '__members__', {}) if n not in ('UNSPECIFIED', 'UNKNOWN')
        ]
        valid = ', '.join(members) if members else str(enum_type)
        raise ValueError(f'Invalid {param_name}: {value!r}. Valid values: {valid}.') from exc
