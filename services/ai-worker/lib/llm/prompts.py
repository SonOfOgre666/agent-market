"""Shared LLM prompts — templates live in ``prompts/`` (edit without touching task code)."""

from __future__ import annotations

from lib.prompt_loader import load_prompt

PLATFORM_RULES = {
    'instagram': 'Visual-focused, emojis encouraged, max 2200 chars, hashtags are critical',
    'linkedin': 'Professional tone, thought leadership, max 3000 chars, minimal hashtags (3-5)',
    'twitter': 'Punchy and concise, MUST be under 280 chars for caption, max 5 hashtags',
    'facebook': 'Conversational, community-oriented, can be longer form, native video preferred',
    'tiktok': 'Casual and trendy, short caption, heavy hashtags, hook in first sentence',
}

UNIVERSAL_POST_RULES = (
    'Write one caption that can be published unchanged on Facebook, Instagram, X, LinkedIn, and TikTok: '
    'hook in the first line, conversational and clear, professional enough for LinkedIn, '
    'caption body under 280 characters (fits X without truncation), 3-8 relevant hashtags, '
    'at most 2 emojis, and a direct call to action'
)
TONE_MAP = {
    'professional': 'authoritative, polished, and credible',
    'friendly': 'warm, approachable, and conversational',
    'funny': 'humorous, witty, and entertaining',
    'marketing': 'persuasive, benefit-driven, and action-oriented',
}
GOAL_MAP = {
    'engagement': 'maximize likes, comments, and shares by encouraging interaction',
    'sales': 'drive conversions and purchases with strong selling points',
    'awareness': 'build brand recognition and reach new audiences',
    'traffic': 'drive clicks to a website or landing page',
}


def _post_context_block(body: dict) -> str:
    """Build context from generate_post output (or legacy prompt-only body)."""
    lines = []
    caption = (body.get('caption') or '').strip()
    if caption:
        lines.append(f'Caption: {caption}')
    hashtags = body.get('hashtags') or []
    if hashtags:
        lines.append(f'Hashtags: {", ".join(str(h) for h in hashtags[:12])}')
    hooks = body.get('hooks') or []
    if hooks:
        lines.append('Hooks: ' + '; '.join(str(h) for h in hooks[:5]))
    ctas = body.get('ctas') or []
    if ctas:
        lines.append('CTAs: ' + '; '.join(str(c) for c in ctas[:5]))
    prompt = (body.get('prompt') or '').strip()
    if prompt and not caption:
        lines.append(f'Topic: {prompt}')
    if not lines:
        raise ValueError('Post context required (caption from generate_post, or prompt)')
    return '\n'.join(lines)


def build_post_prompt(body: dict) -> str:
    post_type = body.get('post_type') or 'image'
    prompt = (body.get('prompt') or '').strip()
    if not prompt:
        raise ValueError('Prompt is required')
    goal = body.get('goal') or 'engagement'
    tone = body.get('tone') or 'friendly'
    language = body.get('language') or 'auto'

    tone_desc = TONE_MAP.get(tone, tone)
    goal_desc = GOAL_MAP.get(goal, goal)
    lang_instruction = (
        'Write in the same language as the user request'
        if language == 'auto'
        else f'Write the caption and all text in: {language}'
    )

    return load_prompt(
        'social/generate_post.md',
        post_type=post_type,
        universal_rules=UNIVERSAL_POST_RULES,
        tone_desc=tone_desc,
        goal_desc=goal_desc,
        lang_instruction=lang_instruction,
        prompt=prompt,
    )


def build_image_script_prompt(body: dict) -> str:
    post_type = body.get('post_type') or 'image'
    purpose = 'video thumbnail' if post_type == 'video' else 'social post image'
    context = _post_context_block(body)
    return load_prompt(
        'social/image_script.md',
        purpose=purpose,
        context=context,
    )


def build_video_script_prompt(body: dict) -> str:
    goal = body.get('goal') or 'engagement'
    tone = body.get('tone') or 'friendly'
    language = body.get('language') or 'auto'
    tone_desc = TONE_MAP.get(tone, tone)
    goal_desc = GOAL_MAP.get(goal, goal)
    lang_instruction = (
        'Write in the same language as the post caption'
        if language == 'auto'
        else f'Write the script in: {language}'
    )
    context = _post_context_block(body)
    return load_prompt(
        'social/video_script.md',
        tone_desc=tone_desc,
        goal_desc=goal_desc,
        lang_instruction=lang_instruction,
        context=context,
    )


# Backward-compatible alias
build_script_prompt = build_video_script_prompt


def build_analyze_comment_prompt(body: dict) -> str:
    comment = (body.get('comment') or '').strip()
    if not comment:
        raise ValueError('comment is required')
    platform = (body.get('platform') or 'instagram').lower()
    post_context = (body.get('post_context') or body.get('postContext') or '').strip()
    platform_rules = PLATFORM_RULES.get(platform, 'Match the tone of the platform')
    post_context_block = f'\nOriginal post context:\n{post_context}\n' if post_context else ''
    return load_prompt(
        'social/analyze_comment.md',
        platform=platform,
        platform_rules=platform_rules,
        post_context_block=post_context_block,
        comment=comment,
    )


def build_campaign_prompt(body: dict) -> str:
    brief = (body.get('brief') or '').strip()
    if not brief:
        raise ValueError('brief is required')
    platform = body.get('platform') or 'facebook'
    objective = body.get('objective') or 'OUTCOME_TRAFFIC'
    budget_amount = body.get('budget_amount', 50)
    language = body.get('language') or 'auto'

    platform_name = {
        'facebook': 'Facebook Ads',
        'instagram': 'Instagram Ads',
        'google_ads': 'Google Ads',
        'tiktok': 'TikTok Ads',
    }.get(platform, platform)
    objective_name = {
        'OUTCOME_AWARENESS': 'Brand Awareness',
        'OUTCOME_TRAFFIC': 'Traffic',
        'OUTCOME_ENGAGEMENT': 'Engagement',
        'OUTCOME_LEADS': 'Lead Generation',
        'OUTCOME_SALES': 'Sales / Conversions',
        'OUTCOME_APP_PROMOTION': 'App Promotion',
    }.get(objective, objective)
    hl_max = {'google_ads': 30, 'facebook': 40, 'instagram': 40, 'tiktok': 100}.get(platform, 40)
    desc_max = {'google_ads': 90, 'facebook': 125, 'instagram': 125, 'tiktok': 512}.get(platform, 125)
    lang_instruction = (
        'Match the language used in the brief'
        if language == 'auto'
        else f'Write all ad copy in: {language}'
    )
    is_google = platform == 'google_ads'
    creative_note = (
        f'For Google Responsive Search Ads: provide 10 headlines (each max {hl_max} chars) and 3 descriptions (each max {desc_max} chars). Google rotates and tests combinations automatically.'
        if is_google
        else f'Provide 1 headline (max {hl_max} chars) and 1 description (max {desc_max} chars). Also include 3 headline variations and 2 description variations for A/B testing.'
    )

    return load_prompt(
        'ads/campaign_brief.md',
        brief=brief,
        platform_name=platform_name,
        objective_name=objective_name,
        budget_amount=budget_amount,
        lang_instruction=lang_instruction,
        creative_note=creative_note,
        objective=objective,
    )


def build_content_calendar_prompt(body: dict) -> str:
    context = (body.get('context_block') or '').strip() or 'No recent posts.'
    platforms = (body.get('platforms') or 'instagram').strip()
    count = int(body.get('count') or 5)
    today = (body.get('today') or '').strip() or ''
    return load_prompt(
        'social/content_calendar.md',
        context_block=context,
        platforms=platforms,
        count=str(count),
        today=today,
    )


def build_seo_keyword_clusters_prompt(body: dict) -> str:
    seeds = body.get('seed_keywords') or []
    if not isinstance(seeds, list) or not seeds:
        raise ValueError('seed_keywords array is required')
    seed_lines = '\n'.join(f'- {str(k).strip()}' for k in seeds if str(k).strip())
    if not seed_lines:
        raise ValueError('seed_keywords array is required')
    return load_prompt(
        'seo/keyword_clusters.md',
        business_context=(body.get('business_context') or 'General marketing').strip(),
        seed_keywords=seed_lines,
        locale=body.get('locale') or 'en-US',
    )


def build_landing_page_plan_prompt(body: dict) -> str:
    prompt = (body.get('prompt') or '').strip()
    if not prompt:
        raise ValueError('prompt is required')

    clarifications = []
    answers = body.get('follow_up_answers') or {}
    if isinstance(answers, dict):
        for key, value in answers.items():
            text = str(value or '').strip()
            if text:
                clarifications.append(f'{key}: {text}')
    clarifications_block = (
        'Additional clarifications from the user:\n' + '\n'.join(clarifications)
        if clarifications
        else 'No additional clarifications yet.'
    )

    return load_prompt(
        'ads/landing_page_plan.md',
        user_brief=prompt,
        clarifications_block=clarifications_block,
    )


def build_video_prompt(body: dict) -> str:
    prompt = (
        (body.get('prompt') or body.get('video_prompt') or '').strip()
    )
    if not prompt:
        raise ValueError('Video prompt is required (from generate_video_script output)')
    style = body.get('style') or 'cinematic'
    style_hints = {
        'cinematic': 'cinematic lighting, smooth camera motion, professional grade',
        'realistic': 'photorealistic, natural motion, lifelike',
        'animated': 'stylized motion graphics, vibrant colors',
        'product': 'product showcase, studio lighting, commercial ad style',
    }
    hint = style_hints.get(style, style_hints['cinematic'])
    suffix = (body or {}).get('_social_video_suffix')
    if suffix:
        return f'{prompt}. Style: {hint}. {suffix}.'
    return f'{prompt}. Style: {hint}.'
