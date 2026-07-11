"""
Account profile refresh (``getAccount`` parity) — execution-only; OAuth stays in apps/api.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict

import httpx
import tweepy

from connectors import google_ads as google_ads_connector

logger = logging.getLogger(__name__)

GRAPH_FB = 'https://graph.facebook.com'
IG_ME = 'https://graph.instagram.com/v21.0/me'
TIKTOK_USER = 'https://open.tiktokapis.com/v2/user/info/'
LINKEDIN_USERINFO = 'https://api.linkedin.com/v2/userinfo'


def _fb_ver(cfg: Dict[str, Any]) -> str:
    v = str((cfg or {}).get('api_version') or 'v25.0').strip()
    return v if v.startswith('v') else f'v{v}'


def _graph_error_message(resp: httpx.Response) -> str:
    try:
        payload = resp.json()
        err = payload.get('error') if isinstance(payload, dict) else None
        if isinstance(err, dict):
            msg = err.get('error_user_msg') or err.get('message') or resp.text
            code = err.get('code')
            if code:
                return f'Meta API error ({code}): {msg}'
            return str(msg)
    except Exception:
        pass
    return f'Graph API HTTP {resp.status_code}'


def _picture_url(picture: Any) -> str | None:
    if not isinstance(picture, dict):
        return None
    if picture.get('url'):
        return str(picture['url'])
    data = picture.get('data')
    if isinstance(data, dict) and data.get('url'):
        return str(data['url'])
    return None


def _digits(s: Any) -> str:
    return re.sub(r'\D', '', str(s or ''))


def fetch_profile_snapshot(ctx: Dict[str, Any], configs: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """
    Returns ``{ok: True, name, username, media, data}`` or ``{ok: False, error}``.
    ``configs`` may include decrypted rows for: ``twitter``, ``linkedin``, ``facebook``,
    ``tiktok``, ``google_ads``, ``instagram_login`` as needed.
    """
    prov = str(ctx.get('provider') or '')
    try:
        if prov == 'twitter':
            return _twitter(ctx, configs.get('twitter') or {})
        if prov == 'linkedin':
            return _linkedin(ctx)
        if prov in ('facebook_page', 'facebook', 'instagram'):
            return _meta_page_ig(ctx, configs.get('facebook') or {}, prov)
        if prov == 'instagram_login':
            return _instagram_login(ctx)
        if prov == 'tiktok':
            return _tiktok(ctx)
        if prov == 'google_ads':
            return _google_ads(ctx, configs.get('google_ads') or {})
        if prov == 'meta_ads':
            return _meta_ads(ctx, configs.get('facebook') or {})
    except Exception as exc:
        logger.warning('[account_profile] %s: %s', prov, exc)
        return {'ok': False, 'error': str(exc)}
    return {'ok': False, 'error': f'Unsupported provider for profile refresh: {prov}'}


def _twitter(ctx: Dict[str, Any], cfg: Dict[str, Any]) -> Dict[str, Any]:
    at = ctx.get('access_token') or {}
    tok, sec = at.get('token'), at.get('secret')
    ck = cfg.get('client_id') or cfg.get('app_key')
    cs = cfg.get('client_secret') or cfg.get('app_secret')
    if not all([tok, sec, ck, cs]):
        return {'ok': False, 'error': 'Twitter tokens or app credentials missing'}
    client = tweepy.Client(consumer_key=ck, consumer_secret=cs, access_token=tok, access_token_secret=sec)
    me = client.get_me(user_fields=['profile_image_url', 'public_metrics'])
    d = me.data
    pm = getattr(d, 'public_metrics', None) if d else None
    metrics: Dict[str, Any] = {}
    if pm is not None:
        if isinstance(pm, dict):
            metrics = dict(pm)
        else:
            for k in ('followers_count', 'following_count', 'tweet_count'):
                v = getattr(pm, k, None)
                if v is not None:
                    metrics[k] = v
    base = dict(ctx.get('data') or {})
    if metrics:
        base['public_metrics'] = metrics
    return {
        'ok': True,
        'name': getattr(d, 'name', None) or ctx.get('name'),
        'username': getattr(d, 'username', None) or ctx.get('username'),
        'media': {'avatar': getattr(d, 'profile_image_url', None)},
        'data': base,
    }


def _linkedin(ctx: Dict[str, Any]) -> Dict[str, Any]:
    token = (ctx.get('access_token') or {}).get('token')
    if not token:
        return {'ok': False, 'error': 'No LinkedIn token'}
    headers = {'Authorization': f'Bearer {token}'}
    r = httpx.get(LINKEDIN_USERINFO, headers=headers, timeout=60.0)
    r.raise_for_status()
    profile = r.json()
    name = (profile.get('name') or f"{profile.get('given_name', '')} {profile.get('family_name', '')}").strip()
    avatar = profile.get('picture')
    return {'ok': True, 'name': name or ctx.get('name'), 'username': name or ctx.get('username'), 'media': {'avatar': avatar}, 'data': dict(ctx.get('data') or {})}


def _meta_page_ig(ctx: Dict[str, Any], fb_cfg: Dict[str, Any], prov: str) -> Dict[str, Any]:
    token = (ctx.get('access_token') or {}).get('token')
    if not token:
        return {'ok': False, 'error': 'No Meta page token'}
    ver = _fb_ver(fb_cfg)
    pid = str(ctx.get('provider_id') or '')
    if not pid:
        return {'ok': False, 'error': 'Missing provider_id'}
    is_ig = prov == 'instagram'
    if is_ig:
        fields = 'id,name,username,profile_picture_url,followers_count'
    else:
        # fan_count is deprecated on New Page Experience — use followers_count
        fields = 'id,name,picture.type(large){url},followers_count'
    url = f'{GRAPH_FB}/{ver}/{pid}'
    field_sets = [fields, 'id,name,followers_count', 'id,name']
    last_error = 'Meta profile refresh failed'
    d: Dict[str, Any] | None = None
    for field_set in field_sets:
        r = httpx.get(url, params={'access_token': token, 'fields': field_set}, timeout=60.0)
        if r.is_success:
            d = r.json()
            break
        last_error = _graph_error_message(r)
        if r.status_code not in (400, 404):
            return {'ok': False, 'error': last_error}
    if not d:
        if 'OAuth' in last_error or 'access token' in last_error.lower():
            return {'ok': False, 'error': f'{last_error} — reconnect the Facebook Page under Accounts.'}
        return {'ok': False, 'error': last_error}

    base = dict(ctx.get('data') or {})
    if is_ig:
        base['followers_count'] = d.get('followers_count')
        return {
            'ok': True,
            'name': d.get('name'),
            'username': d.get('username') or d.get('id'),
            'media': {'avatar': d.get('profile_picture_url')},
            'data': base,
        }
    followers = d.get('followers_count')
    if followers is not None:
        base['followers_count'] = followers
        base['fan_count'] = followers
    elif d.get('fan_count') is not None:
        base['fan_count'] = d.get('fan_count')
    return {
        'ok': True,
        'name': d.get('name'),
        'username': str(d.get('id') or ''),
        'media': {'avatar': _picture_url(d.get('picture'))},
        'data': base,
    }


def _instagram_login(ctx: Dict[str, Any]) -> Dict[str, Any]:
    token = (ctx.get('access_token') or {}).get('token')
    if not token:
        return {'ok': False, 'error': 'No Instagram token'}
    r = httpx.get(
        IG_ME,
        params={'fields': 'id,name,username,profile_picture_url,followers_count', 'access_token': token},
        timeout=60.0,
    )
    r.raise_for_status()
    me = r.json()
    base = dict(ctx.get('data') or {})
    base['followers_count'] = me.get('followers_count')
    return {
        'ok': True,
        'name': me.get('name') or me.get('username'),
        'username': me.get('username'),
        'media': {'avatar': me.get('profile_picture_url')},
        'data': base,
    }


def _tiktok(ctx: Dict[str, Any]) -> Dict[str, Any]:
    token = (ctx.get('access_token') or {}).get('token')
    if not token:
        return {'ok': False, 'error': 'No TikTok token'}
    r = httpx.get(
        TIKTOK_USER,
        params={'fields': 'open_id,display_name,avatar_url,follower_count'},
        headers={'Authorization': f'Bearer {token}'},
        timeout=60.0,
    )
    r.raise_for_status()
    user = (r.json() or {}).get('data', {}).get('user') or {}
    base = dict(ctx.get('data') or {})
    if user.get('follower_count') is not None:
        base['follower_count'] = user.get('follower_count')
    return {
        'ok': True,
        'name': user.get('display_name') or ctx.get('name'),
        'username': user.get('display_name') or ctx.get('username'),
        'media': {'avatar': user.get('avatar_url')},
        'data': base,
    }


def _google_ads(ctx: Dict[str, Any], gcfg: Dict[str, Any]) -> Dict[str, Any]:
    if not google_ads_connector.health_check():
        return {'ok': False, 'error': 'google-ads library not installed in worker'}
    cid = _digits((ctx.get('data') or {}).get('customer_id'))
    if not cid:
        return {
            'ok': True,
            'name': ctx.get('name'),
            'username': ctx.get('username'),
            'media': ctx.get('media') or {},
            'data': ctx.get('data') or {},
        }
    refresh = (ctx.get('access_token') or {}).get('refresh_token')
    dev = gcfg.get('developer_token')
    client_id = gcfg.get('client_id')
    client_secret = gcfg.get('client_secret')
    if not all([refresh, dev, client_id, client_secret]):
        return {'ok': False, 'error': 'Google Ads credentials incomplete'}
    cfg = {
        'developer_token': dev,
        'client_id': client_id,
        'client_secret': client_secret,
        'refresh_token': refresh,
        'use_proto_plus': True,
    }
    import os

    login_cid = (ctx.get('data') or {}).get('login_customer_id') or os.getenv('GOOGLE_ADS_LOGIN_CUSTOMER_ID')
    login_digits = _digits(login_cid)
    cust_digits = _digits(cid)
    if login_digits and login_digits != cust_digits:
        cfg['login_customer_id'] = login_digits
    try:
        client = google_ads_connector.load_client(cfg)
        ga = client.get_service('GoogleAdsService')
        q = 'SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1'
        rows = list(ga.search(customer_id=cid, query=q)) if hasattr(ga, 'search') else []
        if not rows:
            return {
                'ok': True,
                'name': ctx.get('name'),
                'username': ctx.get('username'),
                'media': ctx.get('media') or {},
                'data': ctx.get('data') or {},
            }
        row = rows[0]
        cust = row.customer
        cur = getattr(cust, 'currency_code', None) or 'USD'
        name = getattr(cust, 'descriptive_name', None) or ctx.get('name')
        data = {**(ctx.get('data') or {}), 'currency': cur}
        return {'ok': True, 'name': name, 'username': ctx.get('username'), 'media': ctx.get('media') or {}, 'data': data}
    except Exception as exc:
        logger.warning('[account_profile] google_ads: %s', exc)
        return {
            'ok': True,
            'name': ctx.get('name'),
            'username': ctx.get('username'),
            'media': ctx.get('media') or {},
            'data': ctx.get('data') or {},
        }


def _meta_ads(ctx: Dict[str, Any], fb_cfg: Dict[str, Any]) -> Dict[str, Any]:
    token = (ctx.get('access_token') or {}).get('token') or (ctx.get('data') or {}).get('user_token')
    if not token:
        return {'ok': False, 'error': 'No Meta Ads token'}
    ver = _fb_ver(fb_cfg)
    act_id = (ctx.get('data') or {}).get('ad_account_id')
    if not act_id and ctx.get('provider_id'):
        act_id = f"act_{str(ctx.get('provider_id')).replace('act_', '')}"
    if not act_id:
        return {
            'ok': True,
            'name': ctx.get('name'),
            'username': ctx.get('username'),
            'data': ctx.get('data') or {},
            'media': ctx.get('media') or {},
        }
    aid = str(act_id)
    if not aid.startswith('act_'):
        aid = f'act_{aid.lstrip("act_")}'
    url = f'{GRAPH_FB}/{ver}/{aid}'
    r = httpx.get(url, params={'access_token': token, 'fields': 'id,name,currency,account_status'}, timeout=60.0)
    r.raise_for_status()
    d = r.json()
    return {
        'ok': True,
        'name': d.get('name'),
        'username': str(d.get('id') or ''),
        'media': ctx.get('media') or {},
        'data': {**(ctx.get('data') or {}), 'ad_account_id': d.get('id')},
    }
