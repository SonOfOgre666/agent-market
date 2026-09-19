"""Resolve AI provider API keys from integrations DB (via worker API) only."""

from __future__ import annotations

from typing import Optional

from lib import worker_api


def resolve_api_key(provider: str, workspace_id: Optional[str] = None) -> str:
    provider = (provider or '').strip().lower()
    if not worker_api.configured():
        return ''
    try:
        if workspace_id:
            cfg = worker_api.get_integration_config_decrypted(
                provider, str(workspace_id)
            )
            key = (cfg.get('api_key') or '').strip()
            if key:
                return key
        cfg = worker_api.get_integration_config_decrypted(provider, None)
        return (cfg.get('api_key') or '').strip()
    except Exception:
        return ''


def resolve_ollama_config(workspace_id: Optional[str] = None) -> dict[str, str]:
    if not worker_api.configured():
        return {'base_url': '', 'api_key': ''}
    try:
        cfg = worker_api.get_integration_config_decrypted(
            'ollama', str(workspace_id) if workspace_id else None
        )
        return {
            'base_url': (cfg.get('base_url') or '').strip(),
            'api_key': (cfg.get('api_key') or '').strip(),
        }
    except Exception:
        return {'base_url': '', 'api_key': ''}


def ollama_configured(workspace_id: Optional[str] = None) -> bool:
    return bool(resolve_ollama_config(workspace_id).get('base_url'))


def is_text_provider_configured(provider: str, workspace_id: Optional[str] = None) -> bool:
    p = (provider or '').strip().lower()
    if p == 'ollama':
        return ollama_configured(workspace_id)
    return bool(resolve_api_key(p, workspace_id))


def gemini_configured(workspace_id: Optional[str] = None) -> bool:
    return bool(resolve_api_key('gemini', workspace_id))
