"""
Workflow specifications — source of truth for what can be executed.

The orchestrating LLM understands intent and maps chat to parameters.
Specs define which parameters exist and how they are classified.
Validation and compile layers (google/meta_campaign_spec) enforce these specs.

Google: one workflow per campaign type (search, display, video, shopping, pmax, app, local).
Meta: one workflow per ODAX objective; creative branch drives conditional requirements.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

_GOOGLE_BRANCHES_PATH = (
    Path(__file__).resolve().parents[2] / 'schemas' / 'ads' / 'google_branches.json'
)

GoogleCampaignType = str
MetaObjective = str


class ParameterKind(str, Enum):
    REQUIRED = 'required'
    OPTIONAL = 'optional'
    FIXED = 'fixed'
    DERIVABLE = 'derivable'
    CONDITIONAL = 'conditional'


@dataclass(frozen=True)
class WorkflowParameter:
    name: str
    kind: ParameterKind
    description: str
    condition: str | None = None
    default: Any = None
    user_label: str = ''
    prompt_hint: str = ''


@dataclass(frozen=True)
class WorkflowSpec:
    workflow_id: str
    label: str
    platform: str
    parameters: tuple[WorkflowParameter, ...] = field(default_factory=tuple)
    campaign_type: str | None = None
    meta_objective: str | None = None
    publish_tool: str | None = None

    def required_names(self) -> list[str]:
        return [p.name for p in self.parameters if p.kind == ParameterKind.REQUIRED]

    def derivable_names(self) -> list[str]:
        return [p.name for p in self.parameters if p.kind == ParameterKind.DERIVABLE]

    def conditional_names(self) -> list[str]:
        return [p.name for p in self.parameters if p.kind == ParameterKind.CONDITIONAL]


# ─── Shared parameter definitions ─────────────────────────────────────────────

_BRANCH_KEY_TO_PARAM: dict[str, WorkflowParameter] = {
    'budget': WorkflowParameter('daily_budget', ParameterKind.REQUIRED, 'Daily budget; never defaulted'),
    'end_date': WorkflowParameter('end_date', ParameterKind.REQUIRED, 'Campaign end date'),
    'geo': WorkflowParameter('geo', ParameterKind.REQUIRED, 'Country, city, or region'),
    'final_url': WorkflowParameter(
        'final_url', ParameterKind.REQUIRED, 'Public HTTPS destination URL',
    ),
    'marketing_images': WorkflowParameter(
        'marketing_images',
        ParameterKind.CONDITIONAL,
        'Display / PMax / Local marketing images',
        condition='display, performance_max, local',
    ),
    'logo': WorkflowParameter(
        'logo_image',
        ParameterKind.CONDITIONAL,
        'Square logo image',
        condition='video, performance_max, local',
    ),
    'youtube_video': WorkflowParameter(
        'youtube_video_id',
        ParameterKind.CONDITIONAL,
        'YouTube video URL or id',
        condition='video',
    ),
    'app_id': WorkflowParameter(
        'app_id',
        ParameterKind.CONDITIONAL,
        'Mobile app package / store app id',
        condition='app',
    ),
}

_DERIVABLE_BY_GOOGLE_TYPE: dict[str, tuple[WorkflowParameter, ...]] = {
    'search': (
        WorkflowParameter('keywords', ParameterKind.DERIVABLE, 'Hybrid keyword pipeline + user edits'),
        WorkflowParameter('headlines', ParameterKind.DERIVABLE, 'RSA via google_search_marketing LLM'),
        WorkflowParameter('descriptions', ParameterKind.DERIVABLE, 'RSA via google_search_marketing LLM'),
        WorkflowParameter('negative_keywords', ParameterKind.OPTIONAL, 'User-supplied only'),
        WorkflowParameter('keyword_match_type', ParameterKind.OPTIONAL, 'Defaults to BROAD'),
        WorkflowParameter(
            'business_context',
            ParameterKind.CONDITIONAL,
            'What is being promoted',
            condition='when keywords cannot be inferred',
        ),
    ),
    'display': (
        WorkflowParameter('headlines', ParameterKind.DERIVABLE, 'Responsive display copy via LLM'),
        WorkflowParameter('descriptions', ParameterKind.DERIVABLE, 'Responsive display copy via LLM'),
    ),
    'video': (),
    'shopping': (
        WorkflowParameter(
            'merchant_id',
            ParameterKind.CONDITIONAL,
            'Merchant Center id',
            condition='auto-linked at publish if omitted',
        ),
    ),
    'performance_max': (
        WorkflowParameter('headlines', ParameterKind.DERIVABLE, 'Asset group copy via LLM'),
        WorkflowParameter('descriptions', ParameterKind.DERIVABLE, 'Asset group copy via LLM'),
    ),
    'app': (),
    'local': (
        WorkflowParameter('headlines', ParameterKind.DERIVABLE, 'PMax asset copy via LLM'),
        WorkflowParameter('descriptions', ParameterKind.DERIVABLE, 'PMax asset copy via LLM'),
    ),
}


def _build_google_workflow_spec(campaign_type: str, branch: dict[str, Any]) -> WorkflowSpec:
    label = str(branch.get('label') or campaign_type.title())
    publish_tool = branch.get('publish_tool')
    required_keys = list(branch.get('required_from_user') or branch.get('required') or [])
    derivable_keys = list(branch.get('derivable') or [])

    seen: set[str] = set()
    params: list[WorkflowParameter] = [
        WorkflowParameter('campaign_type', ParameterKind.FIXED, campaign_type),
    ]

    for key in required_keys:
        if key == 'budget':
            key = 'budget'  # maps to daily_budget via _BRANCH_KEY_TO_PARAM
        mapped = _BRANCH_KEY_TO_PARAM.get(key)
        if mapped and mapped.name not in seen:
            params.append(mapped)
            seen.add(mapped.name)

    params.append(WorkflowParameter('start_date', ParameterKind.OPTIONAL, 'Start date; immediate if omitted'))
    params.append(WorkflowParameter('status', ParameterKind.FIXED, 'PAUSED until explicit ENABLE'))
    seen.update({'start_date', 'status'})

    for p in _DERIVABLE_BY_GOOGLE_TYPE.get(campaign_type, ()):
        if p.name not in seen:
            params.append(p)
            seen.add(p.name)

    for key in derivable_keys:
        if key in ('keywords', 'headlines', 'descriptions', 'keyword_match_type'):
            for p in _DERIVABLE_BY_GOOGLE_TYPE.get('search', ()):
                if p.name == key or (key == 'keyword_match_type' and p.name == 'keyword_match_type'):
                    if p.name not in seen:
                        params.append(p)
                        seen.add(p.name)
        if key not in seen and key not in _BRANCH_KEY_TO_PARAM:
            params.append(WorkflowParameter(key, ParameterKind.DERIVABLE, f'Generated {key}'))
            seen.add(key)

    return WorkflowSpec(
        workflow_id=f'google_{campaign_type}_create',
        label=f'Google {label} campaign',
        platform='google_ads',
        campaign_type=campaign_type,
        publish_tool=publish_tool,
        parameters=tuple(params),
    )


def load_google_workflow_specs() -> dict[str, WorkflowSpec]:
    """Build Google workflow specs from schemas/ads/google_branches.json."""
    try:
        data = json.loads(_GOOGLE_BRANCHES_PATH.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError):
        data = {'branches': {}}
    out: dict[str, WorkflowSpec] = {}
    for campaign_type, branch in (data.get('branches') or {}).items():
        spec = _build_google_workflow_spec(str(campaign_type), branch)
        out[spec.workflow_id] = spec
    return out


# ─── Meta Ads — per ODAX objective + creative branches ─────────────────────

_META_COLLECT_BASE: tuple[WorkflowParameter, ...] = (
    WorkflowParameter('page_ids', ParameterKind.REQUIRED, 'Facebook Page(s) on the ad account'),
    WorkflowParameter('daily_budget', ParameterKind.REQUIRED, 'CBO daily budget; never defaulted'),
    WorkflowParameter('end_time', ParameterKind.REQUIRED, 'Campaign end datetime'),
    WorkflowParameter('geo_countries', ParameterKind.REQUIRED, 'ISO country targeting'),
    WorkflowParameter('start_time', ParameterKind.OPTIONAL, 'Optional schedule start'),
    WorkflowParameter('status', ParameterKind.FIXED, 'PAUSED at create'),
    WorkflowParameter('message', ParameterKind.DERIVABLE, 'Primary text via meta_ad_marketing LLM'),
    WorkflowParameter('headline', ParameterKind.DERIVABLE, 'Headline via meta_ad_marketing LLM'),
    WorkflowParameter('description', ParameterKind.DERIVABLE, 'Link description via meta_ad_marketing LLM'),
)

_META_OBJECTIVES: tuple[tuple[str, str, tuple[WorkflowParameter, ...]], ...] = (
    (
        'OUTCOME_TRAFFIC',
        'Meta Traffic campaign',
        (
            WorkflowParameter('link_url', ParameterKind.REQUIRED, 'Public HTTPS destination'),
            WorkflowParameter(
                'creative_format',
                ParameterKind.CONDITIONAL,
                'image or video',
                condition='branch selection',
            ),
        ),
    ),
    (
        'OUTCOME_AWARENESS',
        'Meta Awareness campaign',
        (
            WorkflowParameter(
                'creative_format',
                ParameterKind.CONDITIONAL,
                'image or video (video → ThruPlay)',
                condition='branch selection',
            ),
        ),
    ),
    (
        'OUTCOME_ENGAGEMENT',
        'Meta Engagement campaign',
        (
            WorkflowParameter(
                'creative_format',
                ParameterKind.CONDITIONAL,
                'image or video',
                condition='branch selection',
            ),
        ),
    ),
    (
        'OUTCOME_LEADS',
        'Meta Leads campaign',
        (
            WorkflowParameter(
                'lead_destination',
                ParameterKind.CONDITIONAL,
                'website leads vs instant form',
                condition='branch: leads_website_image | instant_form_image',
            ),
            WorkflowParameter(
                'link_url',
                ParameterKind.CONDITIONAL,
                'HTTPS landing URL',
                condition='leads_website_image branch',
            ),
            WorkflowParameter(
                'lead_form_id',
                ParameterKind.CONDITIONAL,
                'Numeric Instant Form id',
                condition='instant_form_image branch',
            ),
            WorkflowParameter(
                'creative_format',
                ParameterKind.CONDITIONAL,
                'image or video',
                condition='branch selection',
            ),
        ),
    ),
    (
        'OUTCOME_SALES',
        'Meta Sales campaign',
        (
            WorkflowParameter('link_url', ParameterKind.REQUIRED, 'Public HTTPS shop URL'),
            WorkflowParameter(
                'pixel_id',
                ParameterKind.CONDITIONAL,
                'Meta Pixel for conversions',
                condition='required when pixel not on account',
            ),
            WorkflowParameter(
                'creative_format',
                ParameterKind.CONDITIONAL,
                'image or video',
                condition='branch selection',
            ),
        ),
    ),
    (
        'OUTCOME_APP_PROMOTION',
        'Meta App Promotion campaign',
        (
            WorkflowParameter('application_id', ParameterKind.REQUIRED, 'Facebook application id'),
            WorkflowParameter('store_url', ParameterKind.REQUIRED, 'Google Play or App Store URL'),
            WorkflowParameter(
                'creative_format',
                ParameterKind.CONDITIONAL,
                'image or video',
                condition='app_image | app_video branch',
            ),
        ),
    ),
)

META_CREATIVE_BRANCHES: tuple[str, ...] = (
    'single_image',
    'single_video',
    'instant_form_image',
    'leads_website_image',
    'app_image',
    'app_video',
)


def _build_meta_objective_spec(objective: str, label: str, extra: tuple[WorkflowParameter, ...]) -> WorkflowSpec:
    obj_slug = objective.replace('OUTCOME_', '').lower()
    params: list[WorkflowParameter] = [
        WorkflowParameter('objective', ParameterKind.FIXED, objective),
        *_META_COLLECT_BASE,
        *extra,
        WorkflowParameter(
            'dsa_beneficiary',
            ParameterKind.CONDITIONAL,
            'EU DSA beneficiary',
            condition='when geo includes EU countries',
        ),
        WorkflowParameter(
            'dsa_payor',
            ParameterKind.CONDITIONAL,
            'EU DSA payor',
            condition='when geo includes EU countries',
        ),
        WorkflowParameter(
            'creative_image',
            ParameterKind.CONDITIONAL,
            'Image attachment or URL',
            condition='image branches',
        ),
        WorkflowParameter(
            'creative_video',
            ParameterKind.CONDITIONAL,
            'Video attachment',
            condition='video branches',
        ),
    ]
    return WorkflowSpec(
        workflow_id=f'meta_{obj_slug}_create',
        label=label,
        platform='meta_ads',
        meta_objective=objective,
        publish_tool='meta_publish_campaign',
        parameters=tuple(params),
    )


def load_meta_workflow_specs() -> dict[str, WorkflowSpec]:
    out: dict[str, WorkflowSpec] = {}
    for objective, label, extra in _META_OBJECTIVES:
        spec = _build_meta_objective_spec(objective, label, extra)
        out[spec.workflow_id] = spec
    # Generic entry when objective not yet resolved
    out['meta_campaign_create'] = WorkflowSpec(
        workflow_id='meta_campaign_create',
        label='Meta Ads campaign (objective TBD)',
        platform='meta_ads',
        parameters=(
            WorkflowParameter('objective', ParameterKind.REQUIRED, 'ODAX objective'),
            *_META_COLLECT_BASE,
        ),
    )
    return out


# ─── Social, landing page, analytics ────────────────────────────────────────

SOCIAL_POST_CREATE = WorkflowSpec(
    workflow_id='social_post_create',
    label='Social media post',
    platform='social',
    parameters=(
        WorkflowParameter('caption', ParameterKind.DERIVABLE, 'post_generation LLM'),
        WorkflowParameter('media', ParameterKind.OPTIONAL, 'Attachment or generated image/video'),
        WorkflowParameter('schedule_at', ParameterKind.OPTIONAL, 'Publish time'),
        WorkflowParameter('platforms', ParameterKind.OPTIONAL, 'Target accounts'),
    ),
)

LANDING_PAGE_CREATE = WorkflowSpec(
    workflow_id='landing_page_create',
    label='Landing page',
    platform='internal',
    parameters=(
        WorkflowParameter('campaign_name', ParameterKind.REQUIRED, 'Offer / campaign name'),
        WorkflowParameter('headline', ParameterKind.DERIVABLE, 'landing_page_copy LLM'),
        WorkflowParameter('subheadline', ParameterKind.DERIVABLE, 'landing_page_copy LLM'),
        WorkflowParameter('body', ParameterKind.DERIVABLE, 'landing_page_copy LLM'),
        WorkflowParameter('cta_text', ParameterKind.DERIVABLE, 'landing_page_copy LLM'),
        WorkflowParameter('slug', ParameterKind.FIXED, 'System-generated from title'),
    ),
)

SEO_KEYWORD_CLUSTER = WorkflowSpec(
    workflow_id='seo_keyword_cluster',
    label='SEO keyword clustering',
    platform='internal',
    parameters=(
        WorkflowParameter('seed_keywords', ParameterKind.REQUIRED, 'Seed keywords to cluster'),
        WorkflowParameter('business_context', ParameterKind.OPTIONAL, 'Business context for clustering'),
    ),
)

SEO_RANK_TRACKING = WorkflowSpec(
    workflow_id='seo_rank_tracking',
    label='SEO rank tracking',
    platform='internal',
    parameters=(
        WorkflowParameter('target_ids', ParameterKind.OPTIONAL, 'Specific keyword target ids'),
    ),
)

SEO_LANDING_AUDIT = WorkflowSpec(
    workflow_id='seo_landing_audit',
    label='Landing page SEO audit',
    platform='internal',
    parameters=(),
)

COMPETITIVE_ANALYSIS = WorkflowSpec(
    workflow_id='competitive_analysis',
    label='Competitive intelligence',
    platform='internal',
    parameters=(
        WorkflowParameter('competitor_name', ParameterKind.REQUIRED, 'Competitor brand name'),
        WorkflowParameter('competitor_urls', ParameterKind.OPTIONAL, 'Public URLs to scrape'),
    ),
)

GOOGLE_ADS_ANALYTICS = WorkflowSpec(
    workflow_id='google_ads_analytics',
    label='Google Ads read-only insights',
    platform='google_ads',
    parameters=(
        WorkflowParameter('account_id', ParameterKind.REQUIRED, 'Google Ads account'),
        WorkflowParameter('date_range', ParameterKind.OPTIONAL, 'Report window'),
        WorkflowParameter('gaql_query', ParameterKind.OPTIONAL, 'Custom GAQL when applicable'),
    ),
)

META_ADS_ANALYTICS = WorkflowSpec(
    workflow_id='meta_ads_analytics',
    label='Meta Ads read-only insights / audience research',
    platform='meta_ads',
    parameters=(
        WorkflowParameter('account_id', ParameterKind.REQUIRED, 'Meta ad account'),
        WorkflowParameter('ad_account_id', ParameterKind.OPTIONAL, 'Act id override'),
    ),
)

# Generic Google workflow before campaign type is resolved.
GOOGLE_CAMPAIGN_CREATE = WorkflowSpec(
    workflow_id='google_campaign_create',
    label='Google Ads campaign',
    platform='google_ads',
    parameters=(
        WorkflowParameter(
            'campaign_type',
            ParameterKind.REQUIRED,
            'Google campaign channel',
            user_label='Campaign type',
            prompt_hint='Search, Display, Video, Shopping, Performance Max, App, or Local?',
        ),
        WorkflowParameter(
            'daily_budget',
            ParameterKind.REQUIRED,
            'Daily budget',
            user_label='Daily budget',
            prompt_hint='e.g. $25/day (minimum $1; never defaulted)',
        ),
        WorkflowParameter(
            'end_date',
            ParameterKind.REQUIRED,
            'Campaign end date',
            user_label='End date',
            prompt_hint='e.g. 2026-08-01, "until August 1", or "end after 2 days"',
        ),
        WorkflowParameter(
            'geo',
            ParameterKind.REQUIRED,
            'Target location',
            user_label='Target location',
            prompt_hint='Country, city, or region (e.g. Morocco, Casablanca, United States)',
        ),
    ),
)


# UI labels/hints — edit here to change what the agent asks (no code changes elsewhere).
_PARAM_UI: dict[str, tuple[str, str]] = {
    'campaign_type': ('Campaign type', 'Search, Display, Video, Shopping, Performance Max, App, or Local?'),
    'daily_budget': ('Daily budget', 'e.g. $25/day (minimum $1; never defaulted)'),
    'end_date': ('End date', 'When should the campaign stop? e.g. 2026-08-01 or "end after 2 days"'),
    'end_time': ('End date', 'When should the campaign stop? e.g. 2026-07-15 or "until July 15"'),
    'geo': ('Target location', 'Country, city, or region'),
    'geo_countries': ('Target country', 'ISO country e.g. Morocco (MA), US, FR'),
    'final_url': ('Landing page URL', 'Public HTTPS final URL'),
    'link_url': ('Website URL', 'Public HTTPS shop or landing page'),
    'objective': ('Campaign objective', 'Traffic, Awareness, Engagement, Leads, Sales, or App Promotion'),
    'page_ids': ('Facebook Page', 'Which Page should run the ads?'),
    'keywords': ('Keywords', 'Optional — or we generate from your business description'),
    'merchant_id': ('Merchant Center ID', 'Link Merchant Center or paste merchant_id'),
    'app_id': ('App ID', 'Google Play package name or App Store app id'),
    'application_id': ('Application ID', 'Facebook application id for App Promotion'),
    'youtube_video_id': ('YouTube video', 'Paste a YouTube URL or video id'),
    'marketing_images': ('Creative images', 'Attach marketing images in chat (Display/PMax/Local)'),
    'logo_image': ('Logo image', 'Attach a square logo in chat (Video/PMax/Local)'),
    'business_context': ('What you promote', 'Products or services so we can generate keywords and copy'),
    'lead_form_id': ('Lead form ID', 'Numeric Instant Form ID from Meta Lead Ads'),
    'store_url': ('App store URL', 'Google Play or App Store link'),
    'creative_format': ('Creative format', 'Image or video?'),
    'lead_destination': ('Lead destination', 'Website leads or instant form?'),
    'pixel_id': ('Meta Pixel', 'Create in Events Manager or provide pixel_id'),
    'dsa_beneficiary': ('DSA beneficiary', 'EU ads transparency beneficiary name'),
    'dsa_payor': ('DSA payor', 'EU ads transparency payor name'),
    'creative_image': ('Ad image', 'Attach an image in chat'),
    'creative_video': ('Ad video', 'Attach a video in chat'),
}


def param_ui(p: WorkflowParameter) -> tuple[str, str]:
    if p.user_label and p.prompt_hint:
        return p.user_label, p.prompt_hint
    if p.name in _PARAM_UI:
        return _PARAM_UI[p.name]
    label = p.user_label or p.name.replace('_', ' ').title()
    hint = p.prompt_hint or p.description
    return label, hint


# ─── Registry ─────────────────────────────────────────────────────────────────

GOOGLE_WORKFLOW_SPECS: dict[str, WorkflowSpec] = load_google_workflow_specs()
META_WORKFLOW_SPECS: dict[str, WorkflowSpec] = load_meta_workflow_specs()

WORKFLOW_REGISTRY: dict[str, WorkflowSpec] = {
    **GOOGLE_WORKFLOW_SPECS,
    **META_WORKFLOW_SPECS,
    GOOGLE_CAMPAIGN_CREATE.workflow_id: GOOGLE_CAMPAIGN_CREATE,
    SOCIAL_POST_CREATE.workflow_id: SOCIAL_POST_CREATE,
    LANDING_PAGE_CREATE.workflow_id: LANDING_PAGE_CREATE,
    SEO_KEYWORD_CLUSTER.workflow_id: SEO_KEYWORD_CLUSTER,
    SEO_RANK_TRACKING.workflow_id: SEO_RANK_TRACKING,
    SEO_LANDING_AUDIT.workflow_id: SEO_LANDING_AUDIT,
    COMPETITIVE_ANALYSIS.workflow_id: COMPETITIVE_ANALYSIS,
    GOOGLE_ADS_ANALYTICS.workflow_id: GOOGLE_ADS_ANALYTICS,
    META_ADS_ANALYTICS.workflow_id: META_ADS_ANALYTICS,
}

# Back-compat aliases
GOOGLE_SEARCH_CREATE = GOOGLE_WORKFLOW_SPECS.get('google_search_create')
META_CAMPAIGN_CREATE = META_WORKFLOW_SPECS.get('meta_campaign_create')


def google_workflow_id_for_type(campaign_type: GoogleCampaignType) -> str:
    return f'google_{campaign_type}_create'


def meta_workflow_id_for_objective(objective: MetaObjective) -> str:
    slug = objective.replace('OUTCOME_', '').lower()
    return f'meta_{slug}_create'


def get_workflow_spec(workflow_id: str) -> WorkflowSpec | None:
    return WORKFLOW_REGISTRY.get(workflow_id)


def list_workflow_specs_for_platform(platform: str) -> list[WorkflowSpec]:
    return [s for s in WORKFLOW_REGISTRY.values() if s.platform == platform]


def orchestrator_workflow_catalog() -> str:
    """Compact list for the intent-classifier LLM prompt."""
    lines: list[str] = []
    for spec in WORKFLOW_REGISTRY.values():
        req = ', '.join(spec.required_names()[:6]) or 'see spec'
        lines.append(f'- {spec.workflow_id}: {spec.label} [{spec.platform}] required: {req}')
    lines.append('- google_ads_mutate: single Google write tool (pause, budget, etc.)')
    lines.append('- meta_ads_mutate: single Meta write tool')
    lines.append('- unknown: unclear intent')
    return '\n'.join(lines)
