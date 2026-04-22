import os
import json
import logging
from datetime import datetime, timezone
from celery_app import celery_app
from db import get_db, get_redis

logger = logging.getLogger(__name__)

EVENTS_CHANNEL = os.getenv('EVENTS_CHANNEL', 'agent_market:events')


def _emit(event: str, payload: dict):
    """Publish a realtime event to Redis Pub/Sub."""
    try:
        get_redis().publish(EVENTS_CHANNEL, json.dumps({'event': event, **payload}))
    except Exception as exc:
        logger.warning('Failed to emit event %s: %s', event, exc)


# ─── Social Post Tasks ────────────────────────────────────────────────────────

@celery_app.task(name='tasks.publish_social_post', bind=True, max_retries=3)
def publish_social_post(self, post_id: str):
    """Publish a single social post to its target channel."""
    db = get_db()
    post = db.social_posts.find_one({'uuid': post_id})
    if not post:
        logger.error('Post %s not found', post_id)
        return

    channel = post.get('channel', '')
    text = post.get('text', '')
    user_id = post.get('userId', '')

    try:
        # Dispatch to the correct channel connector
        result = _dispatch_to_channel(channel, text, post)
        db.social_posts.update_one(
            {'uuid': post_id},
            {'$set': {
                'status': 'published',
                'publishedAt': datetime.now(timezone.utc),
                'providerPostId': result.get('provider_post_id'),
                'updatedAt': datetime.now(timezone.utc),
            }}
        )
        _emit('post.published', {'postId': post_id, 'userId': user_id, 'channel': channel})
        logger.info('Post %s published to %s', post_id, channel)
    except Exception as exc:
        logger.error('Failed to publish post %s: %s', post_id, exc)
        db.social_posts.update_one(
            {'uuid': post_id},
            {'$set': {
                'status': 'failed',
                'error': str(exc),
                'updatedAt': datetime.now(timezone.utc),
            }}
        )
        _emit('post.failed', {'postId': post_id, 'userId': user_id, 'error': str(exc)})
        raise self.retry(exc=exc, countdown=60)


@celery_app.task(name='tasks.publish_scheduled_posts')
def publish_scheduled_posts():
    """Check for scheduled posts that are due and queue them for publishing."""
    db = get_db()
    now = datetime.now(timezone.utc)
    due_posts = list(db.social_posts.find({
        'status': 'scheduled',
        'scheduledAt': {'$lte': now},
    }))

    for post in due_posts:
        post_id = post['uuid']
        db.social_posts.update_one({'uuid': post_id}, {'$set': {'status': 'processing'}})
        publish_social_post.delay(post_id)
        logger.info('[Beat] Queued post %s for publishing', post_id)

    if due_posts:
        logger.info('[Beat] Queued %d post(s) for publishing', len(due_posts))


# ─── Ads / Campaign Tasks ─────────────────────────────────────────────────────

@celery_app.task(name='tasks.generate_campaign_assets', bind=True, max_retries=2)
def generate_campaign_assets(self, campaign_id: str, campaign_name: str, keywords: list):
    """Generate RSA headlines and descriptions for a Google Ads campaign via AI."""
    try:
        assets = _ai_generate_assets(campaign_name, keywords)
        db = get_db()
        db.ads_campaigns.update_one(
            {'_id': campaign_id},
            {'$set': {'assets': assets, 'updatedAt': datetime.now(timezone.utc)}}
        )
        _emit('campaign.assets_generated', {'campaignId': campaign_id, 'assets': assets})
        logger.info('Assets generated for campaign %s', campaign_id)
        return assets
    except Exception as exc:
        logger.error('generate_campaign_assets failed for %s: %s', campaign_id, exc)
        raise self.retry(exc=exc, countdown=120)


@celery_app.task(name='tasks.generate_landing_page_content', bind=True, max_retries=2)
def generate_landing_page_content(self, landing_page_id: str, campaign_name: str):
    """Generate AI-enhanced landing page copy."""
    try:
        content = _ai_generate_landing_page(campaign_name)
        db = get_db()
        db.ads_landing_pages.update_one(
            {'_id': landing_page_id},
            {'$set': {
                'headline': content['headline'],
                'subheadline': content['subheadline'],
                'body': content['body'],
                'cta_text': content['cta_text'],
                'updatedAt': datetime.now(timezone.utc),
            }}
        )
        _emit('landing_page.content_generated', {'landingPageId': landing_page_id})
        logger.info('Landing page content generated for %s', landing_page_id)
        return content
    except Exception as exc:
        logger.error('generate_landing_page_content failed for %s: %s', landing_page_id, exc)
        raise self.retry(exc=exc, countdown=120)


@celery_app.task(name='tasks.optimize_campaign', bind=True, max_retries=2)
def optimize_campaign(self, campaign_id: str):
    """Run AI-driven optimization analysis on a campaign."""
    try:
        db = get_db()
        campaign = db.ads_campaigns.find_one({'_id': campaign_id})
        if not campaign:
            logger.error('Campaign %s not found', campaign_id)
            return

        metrics = campaign.get('metrics', {})
        suggestions = _ai_optimize(campaign.get('name', ''), metrics)

        db.ads_campaigns.update_one(
            {'_id': campaign_id},
            {'$set': {
                'optimization': {
                    'suggestions': suggestions,
                    'optimizedAt': datetime.now(timezone.utc).isoformat(),
                },
                'updatedAt': datetime.now(timezone.utc),
            }}
        )
        _emit('campaign.optimized', {'campaignId': campaign_id, 'suggestions': suggestions})
        logger.info('Campaign %s optimized', campaign_id)
        return suggestions
    except Exception as exc:
        logger.error('optimize_campaign failed for %s: %s', campaign_id, exc)
        raise self.retry(exc=exc, countdown=120)


@celery_app.task(name='tasks.optimize_active_campaigns')
def optimize_active_campaigns():
    """Beat task: run optimization on all active campaigns."""
    db = get_db()
    campaigns = list(db.ads_campaigns.find({'status': 'active', 'deleted_at': None}))
    for c in campaigns:
        optimize_campaign.delay(str(c['_id']))
    logger.info('[Beat] Queued optimization for %d active campaign(s)', len(campaigns))


@celery_app.task(name='tasks.generate_content_suggestions')
def generate_content_suggestions():
    """Beat task: generate daily AI content suggestions for all users."""
    db = get_db()
    users = list(db.social_posts.distinct('userId'))
    for user_id in users:
        _emit('content.suggestions_ready', {'userId': user_id, 'message': 'New content suggestions available'})
    logger.info('[Beat] Content suggestions generated for %d user(s)', len(users))


# ─── AI helpers (stub — swap with real OpenAI/Anthropic calls) ───────────────

def _ai_generate_assets(campaign_name: str, keywords: list) -> dict:
    openai_key = os.getenv('OPENAI_API_KEY')
    anthropic_key = os.getenv('ANTHROPIC_API_KEY')

    if openai_key:
        import openai
        client = openai.OpenAI(api_key=openai_key)
        kw_str = ', '.join(keywords[:10]) if keywords else campaign_name
        prompt = (
            f"Generate 3 short Google Ads headlines (max 30 chars each) and "
            f"2 descriptions (max 90 chars each) for a campaign called '{campaign_name}' "
            f"targeting keywords: {kw_str}. Respond as JSON: "
            f"{{\"headlines\": [...], \"descriptions\": [...]}}"
        )
        resp = client.chat.completions.create(
            model='gpt-4o-mini',
            messages=[{'role': 'user', 'content': prompt}],
            response_format={'type': 'json_object'},
        )
        return json.loads(resp.choices[0].message.content)

    if anthropic_key:
        import anthropic
        client = anthropic.Anthropic(api_key=anthropic_key)
        kw_str = ', '.join(keywords[:10]) if keywords else campaign_name
        prompt = (
            f"Generate 3 short Google Ads headlines (max 30 chars each) and "
            f"2 descriptions (max 90 chars each) for a campaign called '{campaign_name}' "
            f"targeting keywords: {kw_str}. Respond as JSON only: "
            f"{{\"headlines\": [...], \"descriptions\": [...]}}"
        )
        msg = client.messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=256,
            messages=[{'role': 'user', 'content': prompt}],
        )
        return json.loads(msg.content[0].text)

    # Fallback stub
    return {
        'headlines': [f'Découvrez {campaign_name}', f'{campaign_name} — Offre Exclusive', 'Commencez Aujourd\'hui'],
        'descriptions': [
            f'{campaign_name} vous offre la meilleure solution. Contactez-nous.',
            'Rejoignez des milliers de clients satisfaits. Essayez gratuitement.',
        ],
    }


def _ai_generate_landing_page(campaign_name: str) -> dict:
    return {
        'headline': f'Bienvenue sur {campaign_name}',
        'subheadline': 'La solution idéale pour booster votre croissance',
        'body': (
            f'Découvrez comment {campaign_name} peut transformer votre activité. '
            'Nos experts sont à votre disposition pour vous accompagner vers le succès.'
        ),
        'cta_text': 'Commencer maintenant',
    }


def _ai_optimize(campaign_name: str, metrics: dict) -> list:
    suggestions = []
    ctr = metrics.get('ctr', 0)
    cpc = metrics.get('cpc', 0)
    conversions = metrics.get('conversions', 0)

    if ctr < 2.0:
        suggestions.append({'type': 'headline', 'priority': 'high', 'suggestion': 'Améliorer les titres pour augmenter le CTR (actuellement < 2%)'})
    if cpc > 2.0:
        suggestions.append({'type': 'bid', 'priority': 'medium', 'suggestion': 'Réduire les enchères sur les mots-clés à faible conversion'})
    if conversions == 0:
        suggestions.append({'type': 'landing_page', 'priority': 'high', 'suggestion': 'Optimiser la page de destination pour améliorer le taux de conversion'})
    if not suggestions:
        suggestions.append({'type': 'general', 'priority': 'low', 'suggestion': f'Campagne {campaign_name} performante. Envisager d\'augmenter le budget.'})

    return suggestions


def _dispatch_to_channel(channel: str, text: str, post: dict) -> dict:
    """Dispatch a post to its social channel. Stub — implement real connectors."""
    logger.info('Dispatching post to channel: %s (dry_run mode)', channel)
    # In dry_run mode, just return a fake provider_post_id
    # Real implementation: call LinkedIn API, Instagram Graph API, TikTok API, etc.
    return {'provider_post_id': f'dry_run_{channel}_{post.get("uuid", "unknown")}'}
