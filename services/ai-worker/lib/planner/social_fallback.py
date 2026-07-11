"""Deterministic social post workflow when the planner returns no steps."""

from __future__ import annotations

import re
from typing import Any, Literal

from lib.planner.attached_media import cover_attachment, is_video_attachment, primary_attachment

_FACEBOOK_PROVIDERS = frozenset({'facebook', 'facebook_page'})
_DUAL_PUBLISH_SCHEDULE_STEPS = 10
_IMAGE_CHAIN_STEPS = 4

OutcomeMode = Literal['draft', 'schedule', 'publish_immediate']


def _schedule_publish_fields(platform: str, account_ids: list[str] | None) -> dict[str, Any]:
    """Target pages for schedule_post / publish_post (not create_draft_post)."""
    fields: dict[str, Any] = {'platform': platform}
    if account_ids:
        fields['account_ids'] = list(account_ids)
    return fields


def resolve_max_workflow_steps(ctx: dict[str, Any] | None) -> int:
    """From Settings → AI → Marketing Assistant → Maximum Workflow Steps."""
    n = int((ctx or {}).get('max_workflow_steps') or 10)
    return max(1, min(n, 50))


def is_actionable_social_request(message: str) -> bool:
    m = (message or '').lower()
    if len(m) < 8:
        return False
    action = any(
        k in m
        for k in (
            'create',
            'write',
            'generate',
            'make',
            'publish',
            'schedule',
            'post about',
            'post on',
            'save',
            'draft',
        )
    )
    channel = any(
        k in m
        for k in (
            'facebook',
            'instagram',
            'twitter',
            'linkedin',
            'tiktok',
            'social',
            'page',
        )
    )
    return action and (channel or 'post' in m)


def parse_post_count(message: str) -> int:
    """How many distinct posts the user asked for (default 1)."""
    m = (message or '').lower()
    for pat in (
        r'\b(\d+)\s*posts?\b',
        r'\bcreate\s+(\d+)\s+posts?\b',
        r'\bmake\s+(\d+)\s+posts?\b',
    ):
        match = re.search(pat, m)
        if match:
            n = int(match.group(1))
            if 1 <= n <= 5:
                return n
    if re.search(r'\b(?:two|2)\s+posts?\b', m) or '2 post' in m:
        return 2
    if re.search(r'\b(?:three|3)\s+posts?\b', m):
        return 3
    return 1


def wants_publish_now(message: str) -> bool:
    m = (message or '').lower()
    return any(
        k in m
        for k in (
            'for now',
            'right now',
            'now and',
            'one for now',
            'publish now',
            'post now',
            'immediately',
            'right away',
            'go live now',
        )
    )


def detect_dual_publish_schedule(message: str) -> tuple[bool, int | None]:
    """True when user wants one post now and another scheduled later."""
    mins = parse_schedule_minutes(message)
    return wants_publish_now(message) and mins is not None, mins


def parse_schedule_minutes(message: str) -> int | None:
    m = (message or '').lower()
    if re.search(r'\b(\d+)\s*h(?:our|rs?)?\b', m):
        match = re.search(r'\b(\d+)\s*h(?:our|rs?)?\b', m)
        if match:
            return int(match.group(1)) * 60
    if re.search(r'\b(\d+)\s*min(?:ute)?s?\b', m):
        match = re.search(r'\b(\d+)\s*min(?:ute)?s?\b', m)
        if match:
            return int(match.group(1))
    if 'after 2h' in m or '2 hours' in m or 'two hours' in m:
        return 120
    return None


def detect_outcome_mode(message: str) -> OutcomeMode:
    """draft | schedule | publish_immediate — drives which tail steps are appended."""
    m = (message or '').lower()
    schedule_mins = parse_schedule_minutes(message)

    if schedule_mins is not None:
        return 'schedule'
    if any(k in m for k in ('schedule', 'scheduled', 'later', 'tomorrow', 'in an hour')):
        return 'schedule'
    if any(k in m for k in ('publish now', 'post now', 'immediately', 'right away', 'right now')):
        return 'publish_immediate'
    if 'draft' in m and 'publish' not in m:
        return 'draft'
    if 'save' in m and 'publish' not in m:
        return 'draft'
    if 'publish' in m or 'post on' in m or 'go live' in m:
        return 'publish_immediate'
    return 'draft'


def platform_named_in_message(message: str) -> str | None:
    m = (message or '').lower()
    for p in ('facebook', 'instagram', 'twitter', 'linkedin', 'tiktok'):
        if p in m:
            return p
    return None


def detect_platform(message: str, ctx: dict[str, Any], *, post_type: str = 'image') -> str:
    """Execution platform — from user text, else first connected social account."""
    named = platform_named_in_message(message)
    if named:
        if named == 'tiktok' and post_type != 'video':
            pass
        else:
            return named
    accounts = ctx.get('social_accounts') or ctx.get('accounts_preview') or []
    if post_type != 'video':
        accounts = [a for a in accounts if (a.get('provider') or '') != 'tiktok']
    if accounts:
        return (accounts[0].get('provider') or 'facebook').replace('facebook_page', 'facebook')
    return 'facebook'


def _accounts_for_platform(platform: str, ctx: dict[str, Any]) -> list[dict[str, Any]]:
    accounts = ctx.get('social_accounts') or ctx.get('accounts_preview') or []
    if platform == 'facebook':
        return [a for a in accounts if (a.get('provider') or '') in _FACEBOOK_PROVIDERS]
    if platform == 'instagram':
        return [a for a in accounts if (a.get('provider') or '') in ('instagram', 'instagram_login')]
    return [a for a in accounts if (a.get('provider') or '') == platform]


def platform_phrase(platform: str, ctx: dict[str, Any], *, user_named: bool) -> str:
    """User-facing label — avoid naming a network the user did not ask for."""
    if user_named:
        return platform
    matches = _accounts_for_platform(platform, ctx)
    if len(matches) == 1:
        name = (matches[0].get('name') or matches[0].get('username') or '').strip()
        if name:
            return name
    accounts = ctx.get('social_accounts') or ctx.get('accounts_preview') or []
    if len(accounts) == 1:
        name = (accounts[0].get('name') or accounts[0].get('username') or '').strip()
        if name:
            return name
    return 'your connected page'


def detect_post_type(message: str) -> str:
    m = (message or '').lower()
    if any(k in m for k in ('video', 'reel', 'reels', 'short', 'shorts', 'tiktok video')):
        return 'video'
    return 'image'


def _pick_account_ids(platform: str, ctx: dict[str, Any], *, post_type: str = 'image') -> list[str]:
    if platform == 'tiktok' and post_type != 'video':
        return []
    accounts = ctx.get('social_accounts') or ctx.get('accounts_preview') or []
    if platform == 'facebook':
        matches = [a for a in accounts if (a.get('provider') or '') in _FACEBOOK_PROVIDERS]
    elif platform == 'instagram':
        matches = [a for a in accounts if (a.get('provider') or '') in ('instagram', 'instagram_login')]
    else:
        matches = [a for a in accounts if (a.get('provider') or '') == platform]
    if len(matches) == 1:
        return [str(matches[0]['id'])]
    return []


def normalize_planner_payload(parsed: dict[str, Any]) -> dict[str, Any]:
    """Fix common planner JSON shapes before validation."""
    if not isinstance(parsed, dict):
        return {}
    out = dict(parsed)
    if isinstance(out.get('workflow'), dict):
        nested = out.pop('workflow')
        for key in ('steps', 'intent', 'summary', 'assistant_message', 'approval_gates'):
            if key not in out and nested.get(key) is not None:
                out[key] = nested[key]
    steps = out.get('steps')
    if steps is None:
        out['steps'] = []
    elif not isinstance(steps, list):
        out['steps'] = []
    return out


def _post_script_payload(post_type: str, post_step_id: str) -> dict[str, Any]:
    return {
        'caption': f'{post_step_id}.output.caption',
        'hashtags': f'{post_step_id}.output.hashtags',
        'hooks': f'{post_step_id}.output.hooks',
        'ctas': f'{post_step_id}.output.ctas',
        'post_type': post_type,
        'goal': 'engagement',
        'tone': 'friendly',
        'language': 'auto',
    }


def _social_image_payload(prompt_ref: str, *, purpose: str = 'social_post') -> dict[str, Any]:
    return {
        'prompt': prompt_ref,
        'purpose': purpose,
        'style': 'marketing',
    }


def _post_generation_prompt(user_message: str, *, index: int, total: int, delivery: str) -> str:
    base = user_message.strip()
    return (
        f'{base}\n\n'
        f'Create post {index} of {total}. {delivery} '
        'Use a unique angle, hook, and focus so this post is clearly different from the others.'
    )


def _image_post_chain(
    platform: str,
    prompt: str,
    account_ids: list[str],
    *,
    first_step: int,
) -> tuple[list[dict[str, Any]], str]:
    """One image post through create_draft_post. Returns (steps, create_step_id)."""
    s1, s2, s3, s4 = (f'step_{first_step + i}' for i in range(4))
    create_payload: dict[str, Any] = {
        'caption': f'{s1}.output.caption',
        'hashtags': f'{s1}.output.hashtags',
        'image': f'{s3}.output.image',
    }

    steps = [
        {
            'step_id': s1,
            'tool_id': 'generate_social_post',
            'payload': {
                'post_type': 'image',
                'prompt': prompt,
                'goal': 'engagement',
                'tone': 'friendly',
                'language': 'auto',
            },
            'depends_on': [],
        },
        {
            'step_id': s2,
            'tool_id': 'generate_image_script',
            'payload': _post_script_payload('image', s1),
            'depends_on': [s1],
        },
        {
            'step_id': s3,
            'tool_id': 'generate_image',
            'payload': _social_image_payload(f'{s2}.output.image_prompt'),
            'depends_on': [s2],
        },
        {
            'step_id': s4,
            'tool_id': 'create_draft_post',
            'payload': create_payload,
            'depends_on': [s1, s3],
        },
    ]
    return steps, s4


def _image_post_steps(platform: str, prompt: str, account_ids: list[str]) -> list[dict[str, Any]]:
    steps, _ = _image_post_chain(platform, prompt, account_ids, first_step=1)
    return steps


def _video_post_steps(platform: str, prompt: str, account_ids: list[str]) -> list[dict[str, Any]]:
    create_payload: dict[str, Any] = {
        'caption': 'step_1.output.caption',
        'hashtags': 'step_1.output.hashtags',
        'video': 'step_3.output.video',
        'image': 'step_5.output.image',
    }

    return [
        {
            'step_id': 'step_1',
            'tool_id': 'generate_social_post',
            'payload': {
                'post_type': 'video',
                'prompt': prompt,
                'goal': 'engagement',
                'tone': 'friendly',
                'language': 'auto',
            },
            'depends_on': [],
        },
        {
            'step_id': 'step_2',
            'tool_id': 'generate_video_script',
            'payload': _post_script_payload('video', 'step_1'),
            'depends_on': ['step_1'],
        },
        {
            'step_id': 'step_3',
            'tool_id': 'generate_video',
            'payload': {'video_prompt': 'step_2.output.video_prompt', 'style': 'cinematic'},
            'depends_on': ['step_2'],
        },
        {
            'step_id': 'step_4',
            'tool_id': 'generate_image_script',
            'payload': _post_script_payload('video', 'step_1'),
            'depends_on': ['step_1'],
        },
        {
            'step_id': 'step_5',
            'tool_id': 'generate_image',
            'payload': _social_image_payload('step_4.output.image_prompt'),
            'depends_on': ['step_4'],
        },
        {
            'step_id': 'step_6',
            'tool_id': 'create_draft_post',
            'payload': create_payload,
            'depends_on': ['step_1', 'step_3', 'step_5'],
        },
    ]


def _append_tail(
    steps: list[dict[str, Any]],
    mode: OutcomeMode,
    schedule_mins: int | None,
    platform: str,
    *,
    platform_label: str,
    account_ids: list[str] | None = None,
) -> tuple[list[dict[str, Any]], list[str], str, str]:
    approval_gates: list[str] = []
    create_step = steps[-1]['step_id']
    tail_id = f'step_{int(create_step.split("_")[1]) + 1}'

    if mode == 'schedule':
        schedule_payload: dict[str, Any] = {
            'post_id': f'{create_step}.output.post_id',
            'schedule_in_minutes': schedule_mins if schedule_mins else 60,
            **_schedule_publish_fields(platform, account_ids),
        }
        steps.append({
            'step_id': tail_id,
            'tool_id': 'schedule_post',
            'payload': schedule_payload,
            'depends_on': [create_step],
        })
        if schedule_mins and schedule_mins < 60:
            when = f'in {schedule_mins} minute(s)'
        elif schedule_mins:
            when = f'in {schedule_mins // 60} hour(s)'
        else:
            when = 'for later'
        summary = f'Generate a post, save as draft, then schedule it {when} on {platform_label}.'
        assistant = (
            f'I planned post → scripts → media → draft → schedule for {platform_label}.'
        )
    elif mode == 'publish_immediate':
        steps.append({
            'step_id': tail_id,
            'tool_id': 'publish_post',
            'payload': {
                'post_id': f'{create_step}.output.post_id',
                **_schedule_publish_fields(platform, account_ids),
            },
            'depends_on': [create_step],
            'requires_approval': True,
        })
        approval_gates = [tail_id]
        summary = f'Generate a post, save as draft, then publish immediately on {platform_label} (approval required).'
        assistant = f'I planned post → scripts → media → draft → publish for {platform_label}. Approve before publish.'
    else:
        summary = f'Generate a post and save it as a draft on {platform_label}.'
        assistant = f'I planned post → scripts → media → create_draft_post for {platform_label}.'

    return steps, approval_gates, summary, assistant


def steps_per_image_post(mode: OutcomeMode) -> int:
    return _IMAGE_CHAIN_STEPS + (1 if mode in ('schedule', 'publish_immediate') else 0)


def _cap_post_count(requested: int, mode: OutcomeMode, max_steps: int) -> int:
    per = steps_per_image_post(mode)
    if per <= 0:
        return 1
    return max(1, min(requested, max_steps // per))


def expected_fallback_step_count(
    *,
    post_count: int,
    mode: OutcomeMode,
    dual_publish_schedule: bool,
    max_steps: int,
) -> int:
    """How many steps the fallback graph will produce (respects max_steps cap)."""
    if post_count >= 2 and dual_publish_schedule and max_steps >= _DUAL_PUBLISH_SCHEDULE_STEPS:
        return _DUAL_PUBLISH_SCHEDULE_STEPS
    if post_count >= 2:
        total = _cap_post_count(post_count, mode, max_steps)
        return total * steps_per_image_post(mode)
    per = steps_per_image_post(mode)
    return min(per, max_steps)


def _delivery_hint(index: int, total: int, mode: OutcomeMode, schedule_mins: int | None) -> str:
    if mode == 'publish_immediate':
        return 'This post will be published immediately (after approval).'
    if mode == 'schedule':
        when = f'in {schedule_mins} minute(s)' if schedule_mins else 'for later'
        return f'This post will be scheduled {when}.'
    return 'This post will be saved as a draft.'


def _append_post_tail(
    steps: list[dict[str, Any]],
    create_step: str,
    *,
    mode: OutcomeMode,
    schedule_mins: int | None,
    tail_step: int,
    platform: str,
    account_ids: list[str] | None = None,
) -> tuple[list[str], int]:
    """Append schedule_post or publish_post after create_draft_post. Returns (approval_gates, next_step_num)."""
    approval_gates: list[str] = []
    tail_id = f'step_{tail_step}'
    if mode == 'schedule':
        payload: dict[str, Any] = {
            'post_id': f'{create_step}.output.post_id',
            'schedule_in_minutes': schedule_mins if schedule_mins else 60,
            **_schedule_publish_fields(platform, account_ids),
        }
        steps.append({
            'step_id': tail_id,
            'tool_id': 'schedule_post',
            'payload': payload,
            'depends_on': [create_step],
        })
        return approval_gates, tail_step + 1
    if mode == 'publish_immediate':
        steps.append({
            'step_id': tail_id,
            'tool_id': 'publish_post',
            'payload': {
                'post_id': f'{create_step}.output.post_id',
                **_schedule_publish_fields(platform, account_ids),
            },
            'depends_on': [create_step],
            'requires_approval': True,
        })
        approval_gates.append(tail_id)
        return approval_gates, tail_step + 1
    return approval_gates, tail_step


def _build_multi_image_posts(
    user_message: str,
    *,
    ctx: dict[str, Any],
    platform: str,
    account_ids: list[str],
    post_count: int,
    mode: OutcomeMode,
    schedule_mins: int | None,
    max_steps: int,
) -> dict[str, Any]:
    """N image posts, each with full chain; same outcome mode on every post (draft / schedule / publish)."""
    total = _cap_post_count(post_count, mode, max_steps)
    steps: list[dict[str, Any]] = []
    approval_gates: list[str] = []
    next_step = 1

    for index in range(1, total + 1):
        prompt = _post_generation_prompt(
            user_message,
            index=index,
            total=total,
            delivery=_delivery_hint(index, total, mode, schedule_mins),
        )
        chain, create_step = _image_post_chain(
            platform,
            prompt,
            account_ids,
            first_step=next_step,
        )
        steps.extend(chain)
        next_step += _IMAGE_CHAIN_STEPS
        gates, next_step = _append_post_tail(
            steps,
            create_step,
            mode=mode,
            schedule_mins=schedule_mins,
            tail_step=next_step,
            platform=platform,
            account_ids=account_ids,
        )
        approval_gates.extend(gates)

    truncated = total < post_count
    mode_label = {
        'draft': 'save as drafts',
        'schedule': 'schedule',
        'publish_immediate': 'publish (approval required)',
    }[mode]
    platform_label = platform_phrase(platform, ctx, user_named=platform_named_in_message(user_message) is not None)
    summary = f'Create {total} distinct image posts and {mode_label} on {platform_label}.'
    if truncated:
        summary += f' (Capped at {total} posts — your Maximum Workflow Steps setting is {max_steps}.)'
    assistant = (
        f'I planned {total} separate post → scripts → media → draft'
        + (' → schedule' if mode == 'schedule' else ' → publish' if mode == 'publish_immediate' else '')
        + f' workflows for {platform_label}.'
    )

    return {
        'intent': 'social_content',
        'summary': summary,
        'assistant_message': assistant,
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': approval_gates,
    }


def _build_dual_image_publish_schedule(
    user_message: str,
    ctx: dict[str, Any],
    *,
    platform: str,
    account_ids: list[str],
    schedule_mins: int,
) -> dict[str, Any]:
    """Two image posts: first publish now, second schedule in N minutes."""
    chain1, create1 = _image_post_chain(
        platform,
        _post_generation_prompt(
            user_message,
            index=1,
            total=2,
            delivery='This post will be published immediately.',
        ),
        account_ids,
        first_step=1,
    )
    chain2, create2 = _image_post_chain(
        platform,
        _post_generation_prompt(
            user_message,
            index=2,
            total=2,
            delivery=f'This post will be scheduled {schedule_mins} minutes after the first.',
        ),
        account_ids,
        first_step=6,
    )

    steps = list(chain1)
    approval_gates: list[str] = []

    steps.append({
        'step_id': 'step_5',
        'tool_id': 'publish_post',
        'payload': {
            'post_id': f'{create1}.output.post_id',
            **_schedule_publish_fields(platform, account_ids),
        },
        'depends_on': [create1],
        'requires_approval': True,
    })
    approval_gates.append('step_5')

    steps.extend(chain2)
    steps.append({
        'step_id': 'step_10',
        'tool_id': 'schedule_post',
        'payload': {
            'post_id': f'{create2}.output.post_id',
            'schedule_in_minutes': schedule_mins,
            **_schedule_publish_fields(platform, account_ids),
        },
        'depends_on': [create2],
    })

    platform_label = platform_phrase(
        platform,
        ctx,
        user_named=platform_named_in_message(user_message) is not None,
    )
    summary = (
        f'Create two posts on {platform_label}: publish the first now, '
        f'schedule the second in {schedule_mins} minute(s).'
    )
    assistant = (
        f'I planned two post → scripts → media → draft workflows for {platform_label}: '
        f'post 1 → publish now, post 2 → schedule in {schedule_mins} minutes.'
    )

    return {
        'intent': 'social_content',
        'summary': summary,
        'assistant_message': assistant,
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': approval_gates,
    }


def _attached_media_post_chain(
    platform: str,
    prompt: str,
    account_ids: list[str],
    media_id: str,
    *,
    post_type: str,
    thumbnail_media_id: str | None = None,
    first_step: int = 1,
) -> tuple[list[dict[str, Any]], str]:
    """Social post using user-provided library media (no AI image/video generation)."""
    s1, s2 = (f'step_{first_step}', f'step_{first_step + 1}')
    create_payload: dict[str, Any] = {
        'caption': f'{s1}.output.caption',
        'hashtags': f'{s1}.output.hashtags',
        'media_id': media_id,
    }
    if post_type == 'video':
        create_payload['post_type'] = 'video'
        if thumbnail_media_id:
            create_payload['thumbnail_media_id'] = thumbnail_media_id

    steps = [
        {
            'step_id': s1,
            'tool_id': 'generate_social_post',
            'payload': {
                'post_type': post_type,
                'prompt': prompt,
                'goal': 'engagement',
                'tone': 'friendly',
                'language': 'auto',
                'use_provided_media': True,
            },
            'depends_on': [],
        },
        {
            'step_id': s2,
            'tool_id': 'create_draft_post',
            'payload': create_payload,
            'depends_on': [s1],
        },
    ]
    return steps, s2


def _build_fallback_social_with_attachment(
    user_message: str,
    ctx: dict[str, Any],
    attached: dict[str, Any],
) -> dict[str, Any]:
    post_type = 'video' if is_video_attachment(attached) else 'image'
    platform = detect_platform(user_message, ctx, post_type=post_type)
    mode = detect_outcome_mode(user_message)
    schedule_mins = parse_schedule_minutes(user_message)
    account_ids = _pick_account_ids(platform, ctx, post_type=post_type)
    media_id = str(attached.get('id') or '')
    cover = cover_attachment(ctx.get('attached_media') or [])
    prompt = (
        f'{user_message.strip()}\n\n'
        'The user attached their own media from the library. '
        'Write caption/copy for that asset — do not describe generating new media.'
    )
    user_named = platform_named_in_message(user_message) is not None
    platform_label = platform_phrase(platform, ctx, user_named=user_named)

    steps, _ = _attached_media_post_chain(
        platform,
        prompt,
        account_ids,
        media_id,
        post_type=post_type,
        thumbnail_media_id=str(cover.get('id')) if cover else None,
    )
    steps, approval_gates, summary, assistant = _append_tail(
        steps,
        mode,
        schedule_mins,
        platform,
        platform_label=platform_label,
        account_ids=account_ids,
    )
    kind = 'video' if post_type == 'video' else 'image'
    summary = summary.replace('Generate a post', f'Write copy for your attached {kind}')
    assistant = (
        f'I planned caption generation using your attached {kind}, then create_draft_post '
        f'on {platform_label}'
        + (' → schedule' if mode == 'schedule' else ' → publish' if mode == 'publish_immediate' else '')
        + '.'
    )

    return {
        'intent': 'social_content',
        'summary': summary,
        'assistant_message': assistant,
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': approval_gates,
    }


def build_fallback_social_workflow(user_message: str, ctx: dict[str, Any]) -> dict[str, Any]:
    attached = primary_attachment(ctx.get('attached_media') or [])
    if attached and attached.get('id'):
        return _build_fallback_social_with_attachment(user_message, ctx, attached)

    max_steps = resolve_max_workflow_steps(ctx)
    prompt = user_message.strip()
    post_type = detect_post_type(user_message)
    platform = detect_platform(user_message, ctx, post_type=post_type)
    mode = detect_outcome_mode(user_message)
    schedule_mins = parse_schedule_minutes(user_message)
    account_ids = _pick_account_ids(platform, ctx, post_type=post_type)
    post_count = parse_post_count(user_message)
    dual_pub_sched, dual_mins = detect_dual_publish_schedule(user_message)

    if (
        post_count >= 2
        and dual_pub_sched
        and dual_mins
        and post_type != 'video'
        and max_steps >= _DUAL_PUBLISH_SCHEDULE_STEPS
    ):
        return _build_dual_image_publish_schedule(
            user_message,
            ctx,
            platform=platform,
            account_ids=account_ids,
            schedule_mins=dual_mins,
        )

    if post_count >= 2 and post_type != 'video':
        return _build_multi_image_posts(
            user_message,
            ctx=ctx,
            platform=platform,
            account_ids=account_ids,
            post_count=post_count,
            mode=mode,
            schedule_mins=schedule_mins,
            max_steps=max_steps,
        )

    user_named = platform_named_in_message(user_message) is not None
    platform_label = platform_phrase(platform, ctx, user_named=user_named)

    if post_type == 'video':
        steps = _video_post_steps(platform, prompt, account_ids)
    else:
        steps = _image_post_steps(platform, prompt, account_ids)

    steps, approval_gates, summary, assistant = _append_tail(
        steps,
        mode,
        schedule_mins,
        platform,
        platform_label=platform_label,
        account_ids=account_ids,
    )

    return {
        'intent': 'social_content',
        'summary': summary,
        'assistant_message': assistant,
        'steps': steps,
        'dependencies': [],
        'parallel_groups': [],
        'approval_gates': approval_gates,
    }
