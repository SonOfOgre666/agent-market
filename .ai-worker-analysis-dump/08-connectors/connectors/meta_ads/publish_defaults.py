"""
Ad set defaults aligned with reference_ads/meta_ads/adsets.py (ODAX objective × destination_type).

Production must not import reference_ads; keep this module in sync when reference changes.

Wizard fields (adset_name, optimization_goal, …) are not Graph targeting — strip before resolve_targeting.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

# Fields stored on Mongo ``targeting`` for the UI wizard — never send to Graph ``targeting``.
WIZARD_TARGETING_KEYS = frozenset({
    'adset_name',
    'name',
    'optimization_goal',
    'billing_event',
    'destination_type',
    'pixel_id',
    'custom_event_type',
    'application_id',
    'object_store_url',
})

# reference_ads/meta_ads/adsets.py — valid pairs per objective + destination
_TRAFFIC_WEBSITE_GOALS = frozenset({'LANDING_PAGE_VIEWS', 'LINK_CLICKS', 'IMPRESSIONS', 'REACH'})
_AWARENESS_GOALS = frozenset({'REACH', 'THRUPLAY'})
_GOALS_REQUIRING_VIDEO = frozenset({'THRUPLAY', 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS'})
# Meta API v22+ rejects optimization_goal IMPRESSIONS for Engagement/Awareness (error_subcode 3858327) — use REACH.
_OBJECTIVES_NO_IMPRESSIONS_GOAL = frozenset({'OUTCOME_ENGAGEMENT', 'OUTCOME_AWARENESS'})
_ENGAGEMENT_ON_PLATFORM_GOALS = frozenset({
    'POST_ENGAGEMENT', 'REACH', 'PAGE_LIKES', 'EVENT_RESPONSES', 'THRUPLAY',
})
_OBJECTIVES_WEBSITE_DESTINATION = frozenset({
    'OUTCOME_TRAFFIC', 'OUTCOME_SALES', 'OUTCOME_LEADS',
})
# Instant-form goals (destination ON_AD) — not compatible with website-only link creatives.
_LEADS_FORM_GOALS = frozenset({'LEAD_GENERATION', 'QUALITY_LEAD'})
_LEADS_WEBSITE_GOALS = frozenset({'LINK_CLICKS'})
# Meta rejects LINK_CLICKS on OUTCOME_SALES (error_subcode 2490408); use OUTCOME_TRAFFIC for link clicks.
_SALES_GOALS = frozenset({'OFFSITE_CONVERSIONS', 'VALUE'})
_APP_PROMOTION_GOALS = frozenset({'APP_INSTALLS', 'APP_INSTALLS_AND_OFFSITE_CONVERSIONS', 'VALUE'})
_APP_GOALS_REQUIRING_PROMOTED_OBJECT = _APP_PROMOTION_GOALS

DEFAULT_ADSET_DAILY_BUDGET_CENTS = 1000  # $10 — same order of magnitude as reference_ads campaign default

_VALID_BILLING_EVENTS = frozenset({'IMPRESSIONS', 'LINK_CLICKS'})
_GOALS_ALLOW_LINK_OR_IMPRESSIONS_BILLING = frozenset({'LINK_CLICKS'})

_DEFAULT_CUSTOM_EVENT = 'PURCHASE'


def validate_lead_gen_form_id(lead_gen_form_id: Optional[str]) -> Optional[str]:
    """Meta instant form IDs are numeric — not URLs."""
    raw = str(lead_gen_form_id or '').strip()
    if not raw:
        return None
    lower = raw.lower()
    if lower.startswith('http://') or lower.startswith('https://') or '/' in raw:
        return (
            'lead_gen_form_id must be the numeric Instant Form ID from Meta Ads Manager '
            '(All tools → Instant forms → open form → ID in URL or form settings), not a website URL.'
        )
    digits = raw.replace(' ', '')
    if not digits.isdigit():
        return (
            'lead_gen_form_id must contain only digits (e.g. 123456789012345). '
            'Create the form in Meta Ads Manager → Instant forms.'
        )
    return None


def remap_deprecated_impressions_goal(objective: str, optimization_goal: str) -> str:
    """Graph error_subcode 3858327: IMPRESSIONS optimization is deprecated for Engagement/Awareness."""
    obj = str(objective or '').strip().upper()
    og = str(optimization_goal or '').strip().upper()
    if og == 'IMPRESSIONS' and obj in _OBJECTIVES_NO_IMPRESSIONS_GOAL:
        return 'REACH'
    return og


def resolve_engagement_destination_type(optimization_goal: str, *, has_video: bool = False) -> str:
    """Meta ODAX: OUTCOME_ENGAGEMENT uses ON_POST / ON_VIDEO — never WEBSITE."""
    og = str(optimization_goal or 'POST_ENGAGEMENT').strip().upper()
    if og in _GOALS_REQUIRING_VIDEO or has_video:
        return 'ON_VIDEO'
    return 'ON_POST'


def resolve_billing_event_for_goal(optimization_goal: str, billing_event: Optional[str] = None) -> str:
    og = str(optimization_goal or 'LINK_CLICKS').strip().upper()
    be = str(billing_event or 'IMPRESSIONS').strip().upper()
    if be not in _VALID_BILLING_EVENTS:
        be = 'IMPRESSIONS'
    if og in _GOALS_ALLOW_LINK_OR_IMPRESSIONS_BILLING:
        return be
    return 'IMPRESSIONS'


def validate_adset_delivery_pair(optimization_goal: str, billing_event: str) -> Optional[str]:
    og = str(optimization_goal or '').strip().upper()
    be = str(billing_event or '').strip().upper()
    if be not in _VALID_BILLING_EVENTS:
        return f'Invalid billing_event {be!r}. Use IMPRESSIONS or LINK_CLICKS.'
    if og in _GOALS_ALLOW_LINK_OR_IMPRESSIONS_BILLING:
        return None
    if be != 'IMPRESSIONS':
        return (
            f'billing_event must be IMPRESSIONS for optimization_goal {og} '
            f'(got {be}). Meta error_subcode 1815117.'
        )
    return None


def validate_wizard_publish_goal(
    objective: str,
    optimization_goal: str,
    *,
    has_video: bool = False,
) -> Optional[str]:
    og = str(optimization_goal or '').strip().upper()
    if og in _GOALS_REQUIRING_VIDEO and not has_video:
        return (
            f'optimization_goal {og} requires a video creative (video_id or video_url). '
            'Upload via meta_upload_ad_video or use POST_ENGAGEMENT / REACH for image ads.'
        )
    return None


def build_promoted_object(
    objective: str,
    optimization_goal: str,
    *,
    page_id: Optional[str] = None,
    pixel_id: Optional[str] = None,
    custom_event_type: Optional[str] = None,
    application_id: Optional[str] = None,
    object_store_url: Optional[str] = None,
    existing: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """Build Graph ``promoted_object`` for ad set creation (reference_ads adsets + campaigns)."""
    obj = str(objective or '').strip().upper()
    og = str(optimization_goal or '').strip().upper()
    po: Dict[str, Any] = dict(existing) if isinstance(existing, dict) else {}

    if obj == 'OUTCOME_LEADS' and og in _LEADS_FORM_GOALS:
        if page_id:
            po['page_id'] = str(page_id)
        return po or None

    if obj == 'OUTCOME_SALES' and og in _SALES_GOALS:
        if pixel_id:
            po['pixel_id'] = str(pixel_id)
        if custom_event_type:
            po['custom_event_type'] = str(custom_event_type).strip().upper()
        elif pixel_id and 'custom_event_type' not in po:
            po['custom_event_type'] = _DEFAULT_CUSTOM_EVENT
        return po or None

    if obj == 'OUTCOME_APP_PROMOTION' and og in _APP_GOALS_REQUIRING_PROMOTED_OBJECT:
        if application_id:
            po['application_id'] = str(application_id)
        if object_store_url:
            po['object_store_url'] = str(object_store_url).strip()
        return po or None

    return po or None


def validate_publish_configuration(
    objective: str,
    optimization_goal: str,
    *,
    page_id: Optional[str] = None,
    lead_gen_form_id: Optional[str] = None,
    pixel_id: Optional[str] = None,
    application_id: Optional[str] = None,
    object_store_url: Optional[str] = None,
    has_video: bool = False,
) -> Optional[str]:
    """
    Pre-flight validation before calling Meta (avoids 2490408, 1815430, and unclear form/app errors).
    Returns a user-facing error string, or None if OK.
    """
    obj = str(objective or '').strip().upper()
    og = remap_deprecated_impressions_goal(obj, str(optimization_goal or '').strip().upper())

    video_err = validate_wizard_publish_goal(obj, og, has_video=has_video)
    if video_err:
        return video_err

    if obj == 'OUTCOME_SALES' and og == 'LINK_CLICKS':
        return (
            'LINK_CLICKS is not valid for Sales campaigns on Meta (error_subcode 2490408). '
            'Use Traffic objective for website link clicks, or choose Conversions / Value with a Meta Pixel.'
        )

    if obj == 'OUTCOME_LEADS' and og in _LEADS_FORM_GOALS:
        if not (page_id or '').strip():
            return 'Facebook Page is required for lead form ads (promoted_object.page_id).'
        if not (lead_gen_form_id or '').strip():
            return (
                f'optimization_goal {og} requires a Meta lead form ID (lead_gen_form_id). '
                'Create a form in Meta Ads Manager → Instant forms, then paste its ID.'
            )
        form_err = validate_lead_gen_form_id(lead_gen_form_id)
        if form_err:
            return form_err

    if obj == 'OUTCOME_SALES' and og in _SALES_GOALS:
        if not (pixel_id or '').strip():
            return (
                f'optimization_goal {og} requires a Meta Pixel ID on the ad set (promoted_object.pixel_id). '
                'Find it in Events Manager, or use Traffic objective for link-click ads without a pixel.'
            )

    if obj == 'OUTCOME_APP_PROMOTION':
        if og not in _APP_PROMOTION_GOALS:
            return None
        if not (application_id or '').strip():
            return 'App promotion requires application_id (Facebook app ID from developers.facebook.com).'
        if not (object_store_url or '').strip():
            return 'App promotion requires object_store_url (App Store or Google Play URL).'
        url = str(object_store_url).strip()
        if not any(p in url for p in ('apps.apple.com', 'play.google.com', 'itunes.apple.com')):
            return 'object_store_url must be an App Store (apps.apple.com) or Google Play (play.google.com) URL.'

    return None


def lead_form_creative_cta(objective: str, optimization_goal: str) -> Optional[str]:
    """CTA type for instant-form lead creatives."""
    obj = str(objective or '').strip().upper()
    og = str(optimization_goal or '').strip().upper()
    if obj == 'OUTCOME_LEADS' and og in _LEADS_FORM_GOALS:
        return 'SIGN_UP'
    return None


def strip_wizard_targeting_fields(custom: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not custom:
        return {}
    return {k: v for k, v in custom.items() if k not in WIZARD_TARGETING_KEYS}


def ensure_adset_daily_budget_cents(budget: Optional[Dict[str, Any]]) -> int:
    budget = budget or {}
    amount = budget.get('amount')
    if amount is not None and float(amount) > 0:
        return max(100, int(round(float(amount) * 100)))
    return DEFAULT_ADSET_DAILY_BUDGET_CENTS


def normalize_adset_delivery(
    objective: str,
    *,
    optimization_goal: str,
    billing_event: str,
    destination_type: Optional[str] = None,
    has_link_url: bool = False,
    has_video: bool = False,
) -> Dict[str, Optional[str]]:
    obj = str(objective or 'OUTCOME_TRAFFIC').strip().upper()
    og = remap_deprecated_impressions_goal(obj, str(optimization_goal or '').strip().upper())
    be = str(billing_event or 'IMPRESSIONS').strip().upper()
    dest = (destination_type or '').strip().upper() or None

    if dest == 'WEBSITE' and obj == 'OUTCOME_ENGAGEMENT':
        dest = None

    if obj == 'OUTCOME_TRAFFIC':
        if dest == 'WEBSITE' and og not in _TRAFFIC_WEBSITE_GOALS:
            og = 'LINK_CLICKS'
        elif og not in _TRAFFIC_WEBSITE_GOALS and og not in _AWARENESS_GOALS:
            og = 'LINK_CLICKS' if has_link_url else 'REACH'

    elif obj == 'OUTCOME_AWARENESS':
        if og not in _AWARENESS_GOALS:
            og = 'REACH'

    elif obj == 'OUTCOME_ENGAGEMENT':
        if og not in _ENGAGEMENT_ON_PLATFORM_GOALS:
            og = 'POST_ENGAGEMENT'

    elif obj == 'OUTCOME_LEADS':
        if og in _LEADS_FORM_GOALS:
            pass
        elif og not in _LEADS_WEBSITE_GOALS:
            og = 'LEAD_GENERATION'

    elif obj == 'OUTCOME_SALES':
        if og not in _SALES_GOALS:
            og = 'OFFSITE_CONVERSIONS'

    elif obj == 'OUTCOME_APP_PROMOTION':
        if og not in _APP_PROMOTION_GOALS:
            og = 'APP_INSTALLS'

    be = resolve_billing_event_for_goal(og, be)

    if obj == 'OUTCOME_ENGAGEMENT':
        dest = resolve_engagement_destination_type(og, has_video=has_video)
    elif obj == 'OUTCOME_LEADS' and og in _LEADS_FORM_GOALS:
        dest = 'ON_AD'
    elif obj == 'OUTCOME_APP_PROMOTION':
        dest = 'APP'
    elif obj == 'OUTCOME_AWARENESS' or (og in _GOALS_REQUIRING_VIDEO or has_video):
        dest = None
    elif has_link_url and obj in _OBJECTIVES_WEBSITE_DESTINATION and og in _LEADS_WEBSITE_GOALS | _SALES_GOALS:
        dest = 'WEBSITE'
    elif has_link_url and obj == 'OUTCOME_TRAFFIC':
        dest = 'WEBSITE'

    return {
        'optimization_goal': og,
        'billing_event': be,
        'destination_type': dest,
    }
