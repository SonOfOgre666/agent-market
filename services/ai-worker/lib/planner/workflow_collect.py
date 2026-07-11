"""
Workflow-driven parameter collection — missing required/conditional fields from specs.

Change required vs optional in workflow_spec.py only; compile layers supply values.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lib.planner.workflow_spec import (
    GOOGLE_WORKFLOW_SPECS,
    META_WORKFLOW_SPECS,
    ParameterKind,
    WorkflowSpec,
    get_workflow_spec,
    google_workflow_id_for_type,
    meta_workflow_id_for_objective,
    param_ui,
)


@dataclass(frozen=True)
class MissingParameter:
    name: str
    label: str
    hint: str

    def as_line(self) -> str:
        return f'**{self.label}** — {self.hint}'


def _empty(val: Any) -> bool:
    if val is None:
        return True
    if isinstance(val, str):
        return not val.strip()
    if isinstance(val, (list, tuple, dict)):
        return len(val) == 0
    return False


def compute_missing_from_spec(
    spec: WorkflowSpec,
    values: dict[str, Any],
    *,
    conditional_required: frozenset[str] | None = None,
) -> list[MissingParameter]:
    """Return missing required + active conditional parameters for a workflow spec."""
    cond = conditional_required or frozenset()
    missing: list[MissingParameter] = []
    for p in spec.parameters:
        if p.kind in (ParameterKind.FIXED, ParameterKind.DERIVABLE, ParameterKind.OPTIONAL):
            continue
        if p.kind == ParameterKind.CONDITIONAL and p.name not in cond:
            continue
        if p.kind == ParameterKind.REQUIRED or (
            p.kind == ParameterKind.CONDITIONAL and p.name in cond
        ):
            if _empty(values.get(p.name)):
                label, hint = param_ui(p)
                missing.append(MissingParameter(p.name, label, hint))
    return missing


def missing_lines_from_spec(
    spec: WorkflowSpec,
    values: dict[str, Any],
    *,
    conditional_required: frozenset[str] | None = None,
) -> list[str]:
    return [m.as_line() for m in compute_missing_from_spec(spec, values, conditional_required=conditional_required)]


# ─── Google ───────────────────────────────────────────────────────────────────


def google_spec_for_type(campaign_type: str | None) -> WorkflowSpec | None:
    if campaign_type:
        return get_workflow_spec(google_workflow_id_for_type(campaign_type))
    return get_workflow_spec('google_campaign_create')


def google_values_from_state(
    *,
    campaign_type: str | None,
    budget: float | None,
    end_date: str | None,
    geo_ids: list[int] | None,
    geo_query: str | None,
    geo_countries: list[str] | None,
    geo_intent: Any | None = None,
    final_url: str | None,
    keywords: list[str] | None,
    merchant_id: str | None,
    app_id: str | None,
    youtube_video_id: str | None,
    has_image: bool,
    business_inferable: bool,
) -> dict[str, Any]:
    geo_ok = bool(
        geo_ids
        or geo_query
        or geo_countries
        or (geo_intent and (geo_intent.get('include') or geo_intent.get('exclude')))
    )
    return {
        'campaign_type': campaign_type,
        'daily_budget': budget,
        'end_date': end_date,
        'geo': geo_ok,
        'geo_countries': geo_countries,
        'geo_query': geo_query,
        'final_url': final_url,
        'keywords': keywords,
        'merchant_id': merchant_id,
        'app_id': app_id,
        'youtube_video_id': youtube_video_id,
        'marketing_images': has_image,
        'logo_image': has_image,
        'business_context': business_inferable or keywords,
    }


def google_conditional_required(
    *,
    campaign_type: str | None,
    keywords: list[str] | None,
    business_inferable: bool,
    has_image: bool,
    merchant_id: str | None,
    auto_merchant: bool,
) -> frozenset[str]:
    cond: set[str] = set()
    if not campaign_type:
        return frozenset()
    if campaign_type == 'search' and not keywords and not business_inferable:
        cond.add('business_context')
    branch = (GOOGLE_WORKFLOW_SPECS.get(google_workflow_id_for_type(campaign_type)) or None)
    if not branch:
        return frozenset(cond)
    for p in branch.parameters:
        if p.kind != ParameterKind.CONDITIONAL:
            continue
        if p.name == 'marketing_images' and not has_image:
            cond.add('marketing_images')
        if p.name == 'logo_image' and not has_image:
            cond.add('logo_image')
        if p.name == 'merchant_id' and not merchant_id and not auto_merchant:
            cond.add('merchant_id')
    return frozenset(cond)


def compute_google_missing(
    *,
    campaign_type: str | None,
    budget: float | None,
    end_date: str | None,
    geo_ids: list[int] | None,
    geo_query: str | None,
    geo_countries: list[str] | None,
    geo_intent: Any | None = None,
    final_url: str | None,
    keywords: list[str] | None,
    merchant_id: str | None,
    auto_merchant: bool,
    app_id: str | None,
    youtube_video_id: str | None,
    has_image: bool,
    business_inferable: bool,
    type_ambiguous: bool = False,
) -> list[MissingParameter]:
    if campaign_type is None or type_ambiguous:
        spec = get_workflow_spec('google_campaign_create')
        if not spec:
            return [MissingParameter('campaign_type', 'Campaign type', 'Search, Display, Video, Shopping, PMax, App, or Local?')]
        values = google_values_from_state(
            campaign_type=None,
            budget=budget,
            end_date=end_date,
            geo_ids=geo_ids,
            geo_query=geo_query,
            geo_countries=geo_countries,
            geo_intent=geo_intent,
            final_url=final_url,
            keywords=keywords,
            merchant_id=merchant_id,
            app_id=app_id,
            youtube_video_id=youtube_video_id,
            has_image=has_image,
            business_inferable=business_inferable,
        )
        return compute_missing_from_spec(spec, values)

    spec = google_spec_for_type(campaign_type)
    if not spec:
        return []
    values = google_values_from_state(
        campaign_type=campaign_type,
        budget=budget,
        end_date=end_date,
        geo_ids=geo_ids,
        geo_query=geo_query,
        geo_countries=geo_countries,
        geo_intent=geo_intent,
        final_url=final_url,
        keywords=keywords,
        merchant_id=merchant_id,
        app_id=app_id,
        youtube_video_id=youtube_video_id,
        has_image=has_image,
        business_inferable=business_inferable,
    )
    cond = google_conditional_required(
        campaign_type=campaign_type,
        keywords=keywords,
        business_inferable=business_inferable,
        has_image=has_image,
        merchant_id=merchant_id,
        auto_merchant=auto_merchant,
    )
    return compute_missing_from_spec(spec, values, conditional_required=cond)


# ─── Meta ─────────────────────────────────────────────────────────────────────


def meta_spec_for_objective(objective: str | None) -> WorkflowSpec | None:
    if objective:
        return get_workflow_spec(meta_workflow_id_for_objective(objective))
    return get_workflow_spec('meta_campaign_create')


def meta_values_from_state(
    *,
    objective: str | None,
    page_ids: list[str],
    pages: list[dict[str, str]],
    budget: float | None,
    end_time: str | None,
    geo: list[str] | None,
    geo_intent: Any | None = None,
    link_url: str | None,
    lead_form_id: str | None,
    app_id: str | None,
    store_url: str | None,
    branch: str | None,
    dsa_beneficiary: str | None,
    dsa_payor: str | None,
    has_creative_image: bool,
    has_creative_video: bool,
) -> dict[str, Any]:
    return {
        'objective': objective,
        'page_ids': page_ids if (not pages or len(pages) <= 1 or page_ids) else None,
        'daily_budget': budget,
        'end_time': end_time,
        'geo_countries': geo if geo else (
            ['intent']
            if geo_intent and (geo_intent.get('include') or geo_intent.get('exclude'))
            else None
        ),
        'geo': bool(
            geo
            or (geo_intent and (geo_intent.get('include') or geo_intent.get('exclude')))
        ),
        'link_url': link_url,
        'lead_form_id': lead_form_id,
        'application_id': app_id,
        'store_url': store_url,
        'creative_format': branch,
        'dsa_beneficiary': dsa_beneficiary,
        'dsa_payor': dsa_payor,
        'creative_image': has_creative_image,
        'creative_video': has_creative_video,
        'lead_destination': branch,
    }


def meta_conditional_required(
    *,
    objective: str | None,
    branch: str | None,
    image_video_ambiguous: bool,
    link_url: str | None,
    lead_form_id: str | None,
    app_id: str | None,
    store_url: str | None,
    dsa_required: bool,
    sales_blocked_no_pixel: bool,
    has_image: bool,
    has_video: bool,
) -> frozenset[str]:
    cond: set[str] = set()
    if not objective:
        return frozenset()
    if sales_blocked_no_pixel:
        cond.add('pixel_id')
    if dsa_required:
        cond.add('dsa_beneficiary')
        cond.add('dsa_payor')
    if objective == 'OUTCOME_LEADS':
        if image_video_ambiguous or branch is None:
            cond.add('lead_destination')
            cond.add('creative_format')
        if branch == 'instant_form_image':
            cond.add('lead_form_id')
        if branch == 'leads_website_image':
            cond.add('link_url')
    elif objective == 'OUTCOME_APP_PROMOTION':
        cond.add('application_id')
        cond.add('store_url')
        if branch in ('app_image', 'app_video') or image_video_ambiguous:
            cond.add('creative_format')
    elif objective == 'OUTCOME_SALES':
        cond.add('link_url')
        if image_video_ambiguous or branch is None:
            cond.add('creative_format')
    elif image_video_ambiguous or branch is None:
        cond.add('creative_format')
    if objective in ('OUTCOME_TRAFFIC', 'OUTCOME_SALES') or branch in (
        'single_image', 'single_video', 'leads_website_image',
    ):
        if not link_url and objective != 'OUTCOME_LEADS':
            cond.add('link_url')
    if branch in ('single_image', 'instant_form_image', 'leads_website_image', 'app_image'):
        if not has_image:
            cond.add('creative_image')
    if branch in ('single_video', 'app_video'):
        if not has_video:
            cond.add('creative_video')
    return frozenset(cond)


def compute_meta_missing(
    *,
    objective: str | None,
    branch: str | None,
    image_video_ambiguous: bool,
    pages: list[dict[str, str]],
    page_ids: list[str],
    geo: list[str] | None,
    geo_intent: Any | None = None,
    budget: float | None,
    end_time: str | None,
    link_url: str | None,
    lead_form_id: str | None,
    app_id: str | None,
    store_url: str | None,
    dsa_required: bool,
    dsa_beneficiary: str | None,
    dsa_payor: str | None,
    sales_blocked_no_pixel: bool,
    has_image: bool,
    has_video: bool,
    link_url_acceptable: bool = True,
) -> list[MissingParameter]:
    spec = meta_spec_for_objective(objective)
    if not spec:
        return []
    values = meta_values_from_state(
        objective=objective,
        page_ids=page_ids,
        pages=pages,
        budget=budget,
        end_time=end_time,
        geo=geo,
        geo_intent=geo_intent,
        link_url=link_url if link_url_acceptable else None,
        lead_form_id=lead_form_id,
        app_id=app_id,
        store_url=store_url,
        branch=branch,
        dsa_beneficiary=dsa_beneficiary,
        dsa_payor=dsa_payor,
        has_creative_image=has_image,
        has_creative_video=has_video,
    )
    if not pages:
        return [MissingParameter(
            'page_ids',
            'Facebook Page',
            'Connect a Page in Meta Business Settings (none available on this account)',
        )]
    if pages and len(pages) > 1 and not page_ids:
        from lib.planner.meta_page_selection import format_pages_for_user
        return [MissingParameter('page_ids', 'Facebook Page', format_pages_for_user(pages))]
    if link_url and not link_url_acceptable:
        return [MissingParameter(
            'link_url',
            'Public destination URL',
            f'Meta rejects localhost/private URLs. Provide a public HTTPS shop URL.',
        )]
    cond = meta_conditional_required(
        objective=objective,
        branch=branch,
        image_video_ambiguous=image_video_ambiguous,
        link_url=link_url,
        lead_form_id=lead_form_id,
        app_id=app_id,
        store_url=store_url,
        dsa_required=dsa_required,
        sales_blocked_no_pixel=sales_blocked_no_pixel,
        has_image=has_image,
        has_video=has_video,
    )
    missing = compute_missing_from_spec(spec, values, conditional_required=cond)
    if link_url and not link_url_acceptable:
        missing = [m for m in missing if m.name != 'link_url']
        missing.insert(0, MissingParameter(
            'link_url', 'Public destination URL',
            'Meta requires a public HTTPS URL (not localhost).',
        ))
    return missing
