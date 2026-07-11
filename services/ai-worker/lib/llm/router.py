"""Route AI opcodes to the workspace-configured provider + model (Settings → AI)."""

from __future__ import annotations

import time
import re
from typing import Any, Callable

import httpx

from lib.ai_execution_log import record_router_text_execution, track_execution
from lib.ai_provider_config import resolve_api_key
from lib.ai_workspace_config import OPCODE_TO_FEATURE, get_opcode_assignment
from lib.llm import openai as openai_llm
from lib.llm import prompts
from lib.llm.gemini_video import generate_video as gemini_generate_video
from lib.llm.json_utils import parse_json_text
from lib.llm.social_image import resolve_social_image
from lib.llm.social_video import resolve_social_video
from lib.llm import text as text_llm


def _wid(body: dict | None) -> str | None:
    w = (body or {}).get('workspace_id')
    return str(w).strip() if w else None


def _enrich_body(opcode: str, payload: dict) -> tuple[str, str, dict]:
    wid = _wid(payload)
    assignment = get_opcode_assignment(wid, opcode)
    provider = ((payload or {}).get('ai_provider') or assignment['provider']).lower()
    model = (payload or {}).get('ai_model') or assignment['model']
    api_model_id = (payload or {}).get('api_model_id') or assignment['api_model_id']
    body = {
        **(payload or {}),
        'ai_provider': provider,
        'ai_model': model,
        'api_model_id': api_model_id,
    }
    return provider, model, body


def _require_key(provider: str, workspace_id: str | None) -> str:
    key = resolve_api_key(provider, workspace_id)
    if not key:
        label = {
            'openai': 'OpenAI',
            'anthropic': 'Anthropic',
            'gemini': 'Gemini',
            'openrouter': 'OpenRouter',
        }.get(provider, provider)
        raise RuntimeError(f'{label} API key is not configured. Add it under Settings → AI.')
    return key


def _run_text_json(
    provider: str,
    body: dict,
    *,
    build_prompt: Callable[[dict], str],
    fallback: dict,
    temperature: float = 0.85,
    max_tokens: int = 2048,
    opcode: str | None = None,
    normalize: Callable[[dict, dict], dict] | None = None,
    validate: Callable[[dict], None] | None = None,
) -> dict:
    """Text LLM + JSON parse + optional normalize/validate — one usage log row per attempt."""
    wid = _wid(body)
    usage_out: dict[str, Any] = {}
    t0 = time.perf_counter()
    status = 'success'
    err_msg: str | None = None
    try:
        raw = text_llm.complete(
            provider,
            body.get('ai_model') or '',
            build_prompt(body),
            workspace_id=wid,
            temperature=temperature,
            max_tokens=max_tokens,
            api_model_id=body.get('api_model_id'),
            opcode=opcode,
            source=body.get('execution_source'),
            record_usage=False,
            usage_out=usage_out,
            json_mode=True,
        )
        out = parse_json_text(raw, fallback)
        if not isinstance(out, dict):
            out = dict(fallback)
        if normalize:
            out = normalize(out, body)
        if validate:
            validate(out)
        return out
    except Exception as exc:
        status = 'failed'
        err_msg = str(exc)
        raise
    finally:
        record_router_text_execution(
            provider,
            body,
            opcode,
            usage_out,
            duration_ms=int((time.perf_counter() - t0) * 1000),
            status=status,
            error=err_msg,
        )


def _normalize_image_script(out: dict, body: dict) -> dict:
    out = dict(out or {})
    prompt = (
        (out.get('image_prompt') or '')
        or (out.get('prompt') or '')
        or (out.get('visual_prompt') or '')
        or (out.get('description') or '')
    ).strip()
    if not prompt:
        caption = (body.get('caption') or '').strip()
        hooks = body.get('hooks') if isinstance(body.get('hooks'), list) else []
        hook = (hooks[0] or '').strip() if hooks else ''
        seed = hook or caption[:500]
        if seed:
            prompt = (
                'Professional high-quality social media photograph, cinematic lighting, '
                f'vivid colors, scroll-stopping composition illustrating: {seed}'
            )
    if prompt:
        out['image_prompt'] = prompt
    return out


def _normalize_video_script(out: dict, body: dict) -> dict:
    out = dict(out or {})
    video_prompt = (
        (out.get('video_prompt') or '')
        or (out.get('videoPrompt') or '')
        or (out.get('prompt') or '')
        or (out.get('visual_prompt') or '')
    ).strip()

    if not video_prompt:
        scenes = out.get('scenes') if isinstance(out.get('scenes'), list) else []
        visuals: list[str] = []
        for scene in scenes:
            if not isinstance(scene, dict):
                continue
            visual = (scene.get('visual') or scene.get('description') or scene.get('onscreen') or '').strip()
            if visual:
                visuals.append(visual)
        if visuals:
            video_prompt = '; '.join(visuals)[:500]

    if not video_prompt:
        script = (
            (out.get('script') or '')
            or (out.get('narration') or '')
            or (out.get('voiceover') or '')
            or (out.get('voice_over') or '')
        ).strip()
        if script:
            video_prompt = script[:500]

    if not video_prompt:
        caption = (body.get('caption') or '').strip()
        hooks = body.get('hooks') if isinstance(body.get('hooks'), list) else []
        hook = (hooks[0] or '').strip() if hooks else ''
        seed = hook or caption[:500]
        if seed:
            video_prompt = (
                'Cinematic travel video, smooth camera motion, vibrant colors, professional grade: '
                f'{seed[:430]}'
            )

    if video_prompt:
        out['video_prompt'] = video_prompt
    return out


def _validate_image_script(out: dict) -> None:
    if not (out.get('image_prompt') or '').strip():
        raise ValueError('image_prompt missing from generate_image_script output')


def _validate_video_script(out: dict) -> None:
    if not (out.get('video_prompt') or '').strip():
        raise ValueError('video_prompt missing from generate_video_script output')


def _coerce_reply_text(item: Any) -> str:
    if isinstance(item, str):
        return item.strip()
    if isinstance(item, dict):
        for key in ('text', 'reply', 'message', 'content'):
            value = item.get(key)
            if value:
                return str(value).strip()
    if item is None:
        return ''
    return str(item).strip()


def _normalize_analyze_comment(out: dict, _body: dict) -> dict:
    sentiment = str(out.get('sentiment') or 'neutral').lower()
    if sentiment not in ('positive', 'neutral', 'negative', 'mixed'):
        sentiment = 'neutral'
    replies = (
        out.get('proposed_replies')
        or out.get('replies')
        or out.get('suggested_replies')
        or out.get('reply_options')
        or []
    )
    if not isinstance(replies, list):
        replies = [replies] if replies else []
    replies = [t for t in (_coerce_reply_text(r) for r in replies) if t][:3]
    topics = out.get('topics') or []
    if not isinstance(topics, list):
        topics = []
    urgency = str(out.get('urgency') or 'low').lower()
    if urgency not in ('low', 'medium', 'high'):
        urgency = 'low'
    return {
        'sentiment': sentiment,
        'summary': str(out.get('summary') or '').strip(),
        'topics': [str(t).strip() for t in topics if str(t).strip()][:6],
        'urgency': urgency,
        'proposed_replies': replies,
    }


def _validate_analyze_comment(out: dict) -> None:
    if not out.get('proposed_replies'):
        raise ValueError('proposed_replies missing from analyze_comment output')


def _run_post(provider: str, body: dict) -> dict:
    return _run_text_json(
        provider,
        body,
        build_prompt=prompts.build_post_prompt,
        fallback={'caption': '', 'hashtags': [], 'hooks': [], 'ctas': []},
        opcode='generate_post',
    )


def _run_analyze_comment(provider: str, body: dict) -> dict:
    return _run_text_json(
        provider,
        body,
        build_prompt=prompts.build_analyze_comment_prompt,
        fallback={
            'sentiment': '',
            'summary': '',
            'topics': [],
            'urgency': '',
            'proposed_replies': [],
        },
        temperature=0.4,
        max_tokens=2048,
        opcode='analyze_comment',
        normalize=_normalize_analyze_comment,
        validate=_validate_analyze_comment,
    )


def _validate_calendar_suggestions(out: dict) -> None:
    suggestions = out.get('suggestions') or []
    if not isinstance(suggestions, list) or not suggestions:
        raise ValueError('Content calendar AI returned no suggestions')


def _run_content_calendar(provider: str, body: dict) -> dict:
    return _run_text_json(
        provider,
        body,
        build_prompt=prompts.build_content_calendar_prompt,
        fallback={'suggestions': []},
        temperature=0.6,
        max_tokens=2048,
        opcode='content_calendar_suggestions',
        validate=_validate_calendar_suggestions,
    )


def _normalize_seo_keyword_clusters(out: dict, _body: dict) -> dict:
    clusters = out.get('clusters') or []
    if not isinstance(clusters, list):
        clusters = []
    normalized = []
    for c in clusters:
        if not isinstance(c, dict):
            continue
        intent = str(c.get('intent') or 'informational').lower()
        if intent not in ('informational', 'transactional', 'navigational', 'commercial'):
            intent = 'informational'
        kws = c.get('keywords') or []
        if not isinstance(kws, list):
            kws = []
        normalized.append({
            'name': str(c.get('name') or 'Cluster').strip(),
            'intent': intent,
            'keywords': [str(k).strip().lower() for k in kws if str(k).strip()][:12],
            'content_idea': str(c.get('content_idea') or '').strip(),
        })
    return {
        'clusters': normalized[:8],
        'summary': str(out.get('summary') or '').strip(),
    }


def _validate_seo_keyword_clusters(out: dict) -> None:
    clusters = out.get('clusters') or []
    if not isinstance(clusters, list) or not clusters:
        raise ValueError('SEO keyword clustering returned no clusters')


def _run_seo_keyword_clusters(provider: str, body: dict) -> dict:
    return _run_text_json(
        provider,
        body,
        build_prompt=prompts.build_seo_keyword_clusters_prompt,
        fallback={'clusters': [], 'summary': ''},
        temperature=0.5,
        max_tokens=2048,
        opcode='seo_keyword_clusters',
        normalize=_normalize_seo_keyword_clusters,
        validate=_validate_seo_keyword_clusters,
    )


def _detect_language_code(text: str) -> str:
    """Fallback when the plan LLM omits language — infer from user brief."""
    if not text:
        return 'en'
    if re.search(r'[\u0600-\u06FF\u0750-\u077F]', text):
        return 'ar'
    lower = text.lower()
    if re.search(r'[àâäéèêëïîôùûüç]', lower) or any(
        m in f' {lower} ' for m in (' pour ', ' une ', ' des ', ' créer ', ' page ', ' mon ', ' ma ', ' vos ', ' avec ', ' une ')
    ):
        return 'fr'
    if re.search(r'[ñáéíóúü]', lower) or any(
        m in f' {lower} ' for m in (' para ', ' una ', ' página ', ' crear ', ' mi ', ' con ')
    ):
        return 'es'
    if re.search(r'[äöüß]', lower) or any(
        m in f' {lower} ' for m in (' für ', ' eine ', ' mein ', ' und ', ' seite ')
    ):
        return 'de'
    if any(m in f' {lower} ' for m in (' per ', ' una ', ' mio ', ' creare ', ' pagina ')):
        return 'it'
    if any(m in f' {lower} ' for m in (' para ', ' uma ', ' meu ', ' criar ', ' página ')):
        return 'pt'
    return 'en'


def _sanitize_slug(value: str) -> str:
    slug = re.sub(r'[^a-z0-9]+', '-', (value or '').lower()).strip('-')
    return slug[:80] or 'landing-page'


def _normalize_landing_page_plan(out: dict, body: dict) -> dict:
    seo = out.get('seo_keywords') or out.get('seo') or []
    if isinstance(seo, str):
        seo = [s.strip() for s in seo.split(',') if s.strip()]
    elif not isinstance(seo, list):
        seo = []

    assumptions = out.get('assumptions') or []
    if not isinstance(assumptions, list):
        assumptions = [str(assumptions)] if assumptions else []

    follow_ups = out.get('follow_up_questions') or []
    if not isinstance(follow_ups, list):
        follow_ups = []
    normalized_follow_ups = []
    for i, q in enumerate(follow_ups):
        if not isinstance(q, dict):
            continue
        label = (q.get('label') or q.get('question') or '').strip()
        if not label:
            continue
        normalized_follow_ups.append({
            'id': (q.get('id') or f'q_{i}').strip(),
            'label': label,
            'placeholder': (q.get('placeholder') or '').strip(),
        })

    title = str(out.get('title') or '').strip() or 'New landing page'
    offer = str(out.get('offer') or '').strip()
    slug_raw = str(out.get('slug') or '').strip()
    slug = _sanitize_slug(slug_raw)
    if not slug_raw or slug == 'landing-page':
        slug = _sanitize_slug(seo[0] if seo else title or offer)
    lang_raw = str(out.get('language') or '').strip().lower()[:5]
    detected = _detect_language_code(body.get('prompt') or '')
    if lang_raw and lang_raw not in ('', 'auto', 'en'):
        language = lang_raw
    elif detected != 'en':
        language = detected
    else:
        language = lang_raw or detected or 'en'
    return {
        'title': title,
        'slug': slug,
        'business': str(out.get('business') or '').strip(),
        'goal': str(out.get('goal') or 'Generate leads').strip(),
        'audience': str(out.get('audience') or '').strip(),
        'offer': str(out.get('offer') or '').strip(),
        'tone': str(out.get('tone') or 'Marketing').strip(),
        'seo_keywords': [str(k).strip() for k in seo if str(k).strip()][:8],
        'assumptions': [str(a).strip() for a in assumptions if str(a).strip()][:6],
        'follow_up_questions': normalized_follow_ups[:3],
        'headline_hint': str(out.get('headline_hint') or title).strip(),
        'key_message': str(out.get('key_message') or body.get('prompt') or '').strip(),
        'language': language,
    }


def _validate_landing_page_plan(out: dict) -> None:
    if not (out.get('business') or '').strip():
        raise ValueError('business missing from landing_page_plan output')
    if not (out.get('goal') or '').strip():
        raise ValueError('goal missing from landing_page_plan output')


def _run_landing_page_plan(provider: str, body: dict) -> dict:
    return _run_text_json(
        provider,
        body,
        build_prompt=prompts.build_landing_page_plan_prompt,
        fallback={
            'title': '',
            'slug': '',
            'business': '',
            'goal': '',
            'audience': '',
            'offer': '',
            'tone': '',
            'seo_keywords': [],
            'assumptions': [],
            'follow_up_questions': [],
        },
        temperature=0.45,
        max_tokens=2048,
        opcode='landing_page_plan',
        normalize=_normalize_landing_page_plan,
        validate=_validate_landing_page_plan,
    )


def _run_image_script(provider: str, body: dict) -> dict:
    return _run_text_json(
        provider,
        body,
        build_prompt=prompts.build_image_script_prompt,
        fallback={'image_prompt': ''},
        temperature=0.75,
        max_tokens=4096,
        opcode='generate_image_script',
        normalize=_normalize_image_script,
        validate=_validate_image_script,
    )


def _run_video_script(provider: str, body: dict) -> dict:
    return _run_text_json(
        provider,
        body,
        build_prompt=prompts.build_video_script_prompt,
        fallback={'script': '', 'scenes': [], 'video_prompt': ''},
        temperature=0.75,
        max_tokens=4096,
        opcode='generate_video_script',
        normalize=_normalize_video_script,
        validate=_validate_video_script,
    )



def _run_image(provider: str, body: dict) -> dict:
    wid = _wid(body)
    body = resolve_social_image(body)
    prompt = (body.get('prompt') or '').strip()
    if not prompt:
        raise ValueError('Image prompt is required')
    api_model = (body.get('api_model_id') or body.get('ai_model') or '').strip()
    if not api_model:
        raise RuntimeError('Image model is not configured. Open Settings → AI.')

    with track_execution(
        workspace_id=wid,
        provider=provider,
        model=body.get('ai_model'),
        api_model_id=api_model,
        feature_id=OPCODE_TO_FEATURE['generate_image'],
        opcode='generate_image',
        execution_type='image',
        source=body.get('execution_source'),
    ) as usage:
        if provider == 'gemini':
            from lib.llm.gemini import generate_image as gemini_generate_image

            with httpx.Client() as client:
                out = gemini_generate_image(client, body)
        elif provider == 'openai':
            key = _require_key('openai', wid)
            out = openai_llm.generate_image(
                api_key=key,
                model=api_model,
                body=body,
            )
        else:
            raise RuntimeError(f'Image generation is not supported for provider {provider}')
        if isinstance(out, dict) and out.get('_usage'):
            usage.update(out.pop('_usage'))
        return out


def _run_video(body: dict) -> dict:
    wid = _wid(body)
    assignment = get_opcode_assignment(wid, 'generate_video')
    provider = ((body or {}).get('ai_provider') or assignment['provider']).lower()
    api_model = (
        (body or {}).get('api_model_id')
        or assignment['api_model_id']
    ).strip()
    if not api_model:
        raise RuntimeError('Video model is not configured. Open Settings → AI.')
    prompt = (body.get('video_prompt') or body.get('prompt') or '').strip()
    if not prompt:
        raise ValueError('Video prompt is required (from generate_video_script or upstream caption)')
    body = {**body, 'video_prompt': prompt}
    body = resolve_social_video(body, model=api_model)
    prompt = prompts.build_video_prompt(body)
    seconds = int(body.get('video_duration_seconds') or 8)

    with track_execution(
        workspace_id=wid,
        provider=provider,
        model=body.get('ai_model') or assignment.get('model'),
        api_model_id=api_model,
        feature_id=OPCODE_TO_FEATURE['generate_video'],
        opcode='generate_video',
        execution_type='video',
        source=body.get('execution_source'),
    ):
        if provider == 'openai':
            key = _require_key('openai', wid)
            return openai_llm.generate_video(
                api_key=key,
                model=api_model,
                prompt=prompt,
                seconds=seconds,
                size=body.get('openai_video_size'),
            )
        if provider == 'gemini':
            return gemini_generate_video(
                workspace_id=wid,
                model=api_model,
                prompt=prompt,
                duration_seconds=seconds,
                aspect_ratio=body.get('gemini_aspect_ratio'),
            )
        raise RuntimeError(f'Video generation is not supported for provider {provider}')


def dispatch(opcode: str, payload: dict) -> Any:
    """Run AI opcode using workspace-configured provider + model."""
    if opcode == 'generate_video':
        wid = _wid(payload or {})
        _require_key(
            get_opcode_assignment(wid, 'generate_video')['provider'],
            wid,
        )
        return _run_video(payload or {})

    provider, _model, body = _enrich_body(opcode, payload or {})
    _require_key(provider, _wid(body))

    if opcode == 'generate_post':
        return _run_post(provider, body)
    if opcode in ('generate_video_script', 'generate_script'):
        return _run_video_script(provider, body)
    if opcode == 'generate_image_script':
        return _run_image_script(provider, body)
    if opcode == 'generate_image':
        return _run_image(provider, body)
    if opcode == 'analyze_comment':
        return _run_analyze_comment(provider, body)
    if opcode == 'content_calendar_suggestions':
        return _run_content_calendar(provider, body)
    if opcode == 'seo_keyword_clusters':
        return _run_seo_keyword_clusters(provider, body)
    if opcode == 'landing_page_plan':
        return _run_landing_page_plan(provider, body)
    raise ValueError(f'Unknown AI opcode: {opcode}')
