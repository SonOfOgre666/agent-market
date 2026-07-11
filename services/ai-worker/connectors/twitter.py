"""X (Twitter) execution-only API. OAuth lives in apps/api."""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx
import tweepy

from connectors._ratelimit import parse_retry_after, rate_ttl, store_rate
from connectors._social_content import account_id_str, extract_text_link_media
from connectors._social_media import partition_post_media, primary_thumbnail, primary_video
from connectors.social_types import SocialPublishOutcome

logger = logging.getLogger(__name__)


def publish_post(
    *,
    r: Any,
    post: dict,
    account: dict,
    version: dict,
    tw_cfg: Dict[str, Any],
) -> SocialPublishOutcome:
    account_id = account_id_str(account)
    ttl = rate_ttl(r, 'twitter', account_id)
    if ttl:
        return SocialPublishOutcome(ok=False, error=f'Rate limited — retry in {ttl}s')

    ck, cs = tw_cfg.get('client_id'), tw_cfg.get('client_secret')
    at = account.get('access_token') or {}
    tok, sec = at.get('token'), at.get('secret')
    if not all([ck, cs, tok, sec]):
        return SocialPublishOutcome(ok=False, error='Twitter app or account tokens missing')

    text, _link, _ = extract_text_link_media(version)
    parts = partition_post_media(version)
    video = primary_video(parts)
    images = parts['images']
    thumb = primary_thumbnail(parts)
    if thumb and thumb.get('url'):
        logger.info('[connector.twitter] custom video cover ignored — organic posts do not support poster images')
    media_ids: list[str] = []
    auth = tweepy.OAuth1UserHandler(ck, cs, tok, sec)
    api = tweepy.API(auth)
    client = tweepy.Client(consumer_key=ck, consumer_secret=cs, access_token=tok, access_token_secret=sec)

    try:
        upload_items = [video] if video else images[:4]
        for item in upload_items:
            if not item:
                continue
            url = item.get('url')
            if not url:
                continue
            try:
                resp = httpx.get(url, timeout=120.0, follow_redirects=True)
                resp.raise_for_status()
                buf = io.BytesIO(resp.content)
                mime = (item.get('mime_type') or 'image/jpeg').lower()
                if mime.startswith('video/'):
                    ext = '.mp4' if 'mp4' in mime else '.mov' if 'quicktime' in mime else '.mp4'
                elif 'png' in mime:
                    ext = '.png'
                elif 'gif' in mime:
                    ext = '.gif'
                else:
                    ext = '.jpg'
                up = api.media_upload(filename=f'media{ext}', file=buf)
                mid = getattr(up, 'media_id_string', None) or str(up.media_id)
                if mid:
                    media_ids.append(mid)
            except Exception as exc:
                logger.warning('[connector.twitter] media skip: %s', exc)

        kwargs: Dict[str, Any] = {'text': text or ' '}
        if media_ids:
            kwargs['media_ids'] = media_ids[:4]
        tw = client.create_tweet(**kwargs)
        raw_id = getattr(tw.data, 'id', None) if tw and tw.data else None
        if raw_id is None and tw and tw.data and isinstance(tw.data, dict):
            raw_id = tw.data.get('id')
        tid = str(raw_id) if raw_id is not None else None
        if not tid:
            return SocialPublishOutcome(ok=False, error='Twitter create_tweet returned no id')
        return SocialPublishOutcome(
            ok=True,
            provider_post_id=tid,
            upsert_data={'provider_post_id': tid, 'url': f'https://twitter.com/i/web/status/{tid}'},
        )
    except tweepy.TooManyRequests as exc:
        retry = 900
        if exc.response is not None and exc.response.headers:
            retry = parse_retry_after(dict(exc.response.headers))
        is_app = bool(exc.response and exc.response.headers.get('x-app-limit-24hour-reset'))
        store_rate(r, 'twitter', account_id, retry, app_level=is_app)
        raise ValueError(f'Rate limited — retry in {retry}s') from exc
    except tweepy.Unauthorized:
        return SocialPublishOutcome(ok=False, error='Twitter unauthorized', account_deauthorized=True)


def upload_media(*_args: Any, **_kwargs: Any) -> Dict[str, Any]:
    return {'ok': False, 'error': 'Standalone upload_media is not used — media uploads happen inside publish_post.'}


def fetch_post_metrics(
    *,
    client_id: str,
    client_secret: str,
    access_token: str,
    access_token_secret: str,
    provider_post_id: str,
    **_kwargs: Any,
) -> Dict[str, Any]:
    """Fetch tweet public metrics via X API v2."""
    if not provider_post_id:
        return {'ok': False, 'error': 'provider_post_id is required'}
    try:
        client = tweepy.Client(
            consumer_key=client_id,
            consumer_secret=client_secret,
            access_token=access_token,
            access_token_secret=access_token_secret,
        )
        resp = client.get_tweet(str(provider_post_id), tweet_fields=['public_metrics'])
        if not resp or not resp.data:
            return {'ok': False, 'error': 'Tweet not found'}
        pm = getattr(resp.data, 'public_metrics', None) or {}
        if not isinstance(pm, dict):
            pm = dict(pm) if pm else {}
        return {
            'ok': True,
            'provider_post_id': str(provider_post_id),
            'metrics': {
                'impression_count': pm.get('impression_count'),
                'like_count': pm.get('like_count'),
                'retweet_count': pm.get('retweet_count'),
                'reply_count': pm.get('reply_count'),
                'quote_count': pm.get('quote_count'),
            },
        }
    except tweepy.Unauthorized:
        return {'ok': False, 'error': 'Twitter unauthorized', 'unauthorized': True}
    except tweepy.TooManyRequests:
        return {'ok': False, 'error': 'Twitter rate limited', 'rate_limited': True}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


@dataclass
class TwitterFollowersReadResult:
    ok: bool
    followers_count: int = 0
    rate_limited: bool = False
    unauthorized: bool = False
    retryable_api_error: bool = False


def fetch_authenticated_user_followers(
    client_id: str,
    client_secret: str,
    access_token: str,
    access_token_secret: str,
) -> TwitterFollowersReadResult:
    """X API v2: authenticated user + ``public_metrics.followers_count``."""
    try:
        client = tweepy.Client(
            consumer_key=client_id,
            consumer_secret=client_secret,
            access_token=access_token,
            access_token_secret=access_token_secret,
        )
        me = client.get_me(user_fields=['public_metrics'])
        if not me or not me.data:
            return TwitterFollowersReadResult(ok=False, retryable_api_error=True)
        data = me.data
        pm = getattr(data, 'public_metrics', None)
        followers = 0
        if pm is not None:
            if isinstance(pm, dict):
                followers = int(pm.get('followers_count') or 0)
            else:
                followers = int(getattr(pm, 'followers_count', None) or 0)
        return TwitterFollowersReadResult(ok=True, followers_count=followers)
    except tweepy.TooManyRequests:
        return TwitterFollowersReadResult(ok=False, rate_limited=True)
    except tweepy.Unauthorized:
        return TwitterFollowersReadResult(ok=False, unauthorized=True)
    except tweepy.TweepyException:
        return TwitterFollowersReadResult(ok=False, retryable_api_error=True)


@dataclass
class TwitterUserTimelinePageResult:
    ok: bool
    tweets: List[Dict[str, Any]] = field(default_factory=list)
    next_token: Optional[str] = None
    rate_limited: bool = False
    unauthorized: bool = False
    retryable_api_error: bool = False


def fetch_user_timeline_page(
    client_id: str,
    client_secret: str,
    access_token: str,
    access_token_secret: str,
    provider_user_id: str,
    since,
    pagination_token: str = '',
) -> TwitterUserTimelinePageResult:
    """One page of user tweets (v2), excluding retweets/replies."""
    try:
        client = tweepy.Client(
            consumer_key=client_id,
            consumer_secret=client_secret,
            access_token=access_token,
            access_token_secret=access_token_secret,
        )
        kwargs: Dict[str, Any] = {
            'id': str(provider_user_id),
            'tweet_fields': ['public_metrics', 'created_at', 'in_reply_to_user_id'],
            'start_time': since,
            'exclude': ['retweets', 'replies'],
            'max_results': 100,
        }
        if pagination_token:
            kwargs['pagination_token'] = pagination_token

        timeline = client.get_users_tweets(**kwargs)
        tweets_raw = (timeline.data or []) if timeline else []
        rows: List[Dict[str, Any]] = []
        for tweet in tweets_raw:
            tid = str(tweet.id)
            text = tweet.text or ''
            created = tweet.created_at
            if hasattr(created, 'isoformat'):
                created_s = created.isoformat()
            else:
                created_s = str(created) if created else ''
            pm = getattr(tweet, 'public_metrics', None)
            if isinstance(pm, dict):
                likes = int(pm.get('like_count') or 0)
                replies = int(pm.get('reply_count') or 0)
                retweets = int(pm.get('retweet_count') or 0)
                impressions = int(pm.get('impression_count') or 0)
            else:
                likes = int(getattr(pm, 'like_count', None) or 0)
                replies = int(getattr(pm, 'reply_count', None) or 0)
                retweets = int(getattr(pm, 'retweet_count', None) or 0)
                impressions = int(getattr(pm, 'impression_count', None) or 0)
            rows.append(
                {
                    'id': tid,
                    'text': text,
                    'created_at': created_s,
                    'likes': likes,
                    'replies': replies,
                    'retweets': retweets,
                    'impressions': impressions,
                }
            )

        meta = getattr(timeline, 'meta', None) if timeline else None
        next_token: Optional[str] = None
        if meta:
            if isinstance(meta, dict):
                next_token = meta.get('next_token')
            else:
                next_token = getattr(meta, 'next_token', None)

        return TwitterUserTimelinePageResult(ok=True, tweets=rows, next_token=next_token)
    except tweepy.TooManyRequests:
        return TwitterUserTimelinePageResult(ok=False, rate_limited=True)
    except tweepy.Unauthorized:
        return TwitterUserTimelinePageResult(ok=False, unauthorized=True)
    except tweepy.TweepyException:
        return TwitterUserTimelinePageResult(ok=False, retryable_api_error=True)


def fetch_comments(
    *,
    client_id: str,
    client_secret: str,
    access_token: str,
    access_token_secret: str,
    provider_post_id: str,
    limit: int = 50,
) -> Dict[str, Any]:
    """Fetch replies in a tweet conversation via X API v2 search."""
    pid = str(provider_post_id or '').strip()
    if not pid or not all([client_id, client_secret, access_token, access_token_secret]):
        return {'ok': False, 'error': 'Missing tweet id or Twitter credentials', 'comments': []}
    try:
        client = tweepy.Client(
            consumer_key=client_id,
            consumer_secret=client_secret,
            access_token=access_token,
            access_token_secret=access_token_secret,
        )
        query = f'conversation_id:{pid}'
        comments: List[Dict[str, Any]] = []
        next_token: Optional[str] = None
        pages = 0
        user_map: Dict[str, str] = {}

        while pages < 5 and len(comments) < limit:
            pages += 1
            kwargs: Dict[str, Any] = {
                'query': query,
                'max_results': min(100, limit),
                'tweet_fields': ['created_at', 'author_id', 'conversation_id'],
                'expansions': ['author_id'],
                'user_fields': ['username', 'name'],
            }
            if next_token:
                kwargs['next_token'] = next_token
            resp = client.search_recent_tweets(**kwargs)
            if not resp or not resp.data:
                break
            if resp.includes:
                users = getattr(resp.includes, 'users', None) or []
                for user in users:
                    uid = str(getattr(user, 'id', '') or '')
                    if not uid:
                        continue
                    name = getattr(user, 'name', None) or getattr(user, 'username', None)
                    user_map[uid] = str(name) if name else uid
            for tweet in resp.data:
                tid = str(tweet.id)
                if tid == pid:
                    continue
                text = (tweet.text or '').strip()
                if not text:
                    continue
                author_id = str(getattr(tweet, 'author_id', '') or '')
                created = tweet.created_at
                created_s = created.isoformat() if hasattr(created, 'isoformat') else str(created or '')
                comments.append({
                    'provider_comment_id': tid,
                    'comment': text,
                    'author': user_map.get(author_id) or author_id or None,
                    'platform_created_at': created_s,
                })
            meta = getattr(resp, 'meta', None)
            next_token = None
            if meta:
                next_token = meta.get('next_token') if isinstance(meta, dict) else getattr(meta, 'next_token', None)
            if not next_token:
                break

        return {'ok': True, 'comments': comments[:limit], 'provider': 'twitter'}
    except tweepy.Unauthorized:
        return {'ok': False, 'error': 'Twitter unauthorized', 'oauth_invalid': True, 'comments': []}
    except tweepy.Forbidden as exc:
        return {
            'ok': False,
            'error': 'Twitter API access denied for conversation search (may require elevated tier)',
            'comments': [],
        }
    except tweepy.TooManyRequests:
        return {'ok': False, 'error': 'Twitter rate limited', 'rate_limited': True, 'comments': []}
    except tweepy.TweepyException as exc:
        return {'ok': False, 'error': str(exc), 'comments': []}
    except Exception as exc:
        return {'ok': False, 'error': str(exc), 'comments': []}


def reply_to_comment(
    *,
    client_id: str,
    client_secret: str,
    access_token: str,
    access_token_secret: str,
    provider_comment_id: str,
    message: str,
) -> Dict[str, Any]:
    """Reply to a tweet via X API v2."""
    cid = str(provider_comment_id or '').strip()
    text = str(message or '').strip()
    if not cid or not text:
        return {'ok': False, 'error': 'Missing tweet id or reply text'}
    try:
        client = tweepy.Client(
            consumer_key=client_id,
            consumer_secret=client_secret,
            access_token=access_token,
            access_token_secret=access_token_secret,
        )
        tw = client.create_tweet(text=text, in_reply_to_tweet_id=cid)
        raw_id = getattr(tw.data, 'id', None) if tw and tw.data else None
        if raw_id is None and tw and tw.data and isinstance(tw.data, dict):
            raw_id = tw.data.get('id')
        return {'ok': True, 'provider_reply_id': str(raw_id) if raw_id else None}
    except tweepy.Unauthorized:
        return {'ok': False, 'error': 'Twitter unauthorized', 'oauth_invalid': True}
    except tweepy.TooManyRequests:
        return {'ok': False, 'error': 'Twitter rate limited', 'rate_limited': True}
    except tweepy.TweepyException as exc:
        return {'ok': False, 'error': str(exc)}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}
