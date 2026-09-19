"""Decrypt ``integrations`` row for Google Ads (merged with env like apps/api GoogleAdsProvider)."""

import os
from typing import Any, Dict

from lib.integration_config import integration_configs_collection
from ..imports._service_decrypt import decrypt_service_configuration


def get_google_ads_service_configuration(db, workspace_id=None) -> Dict[str, Any]:
    coll = integration_configs_collection(db)
    q: Dict[str, Any] = {'name': 'google_ads'}
    doc = None
    if workspace_id is not None:
        ws = str(workspace_id)
        doc = coll.find_one({**q, 'workspace_id': ws})
    if not doc:
        doc = coll.find_one(q)
    if not doc or not doc.get('configuration'):
        return {}
    return decrypt_service_configuration(doc['configuration'])


def merge_google_ads_credentials(cfg: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(cfg)
    out.setdefault('client_id', os.getenv('GOOGLE_ADS_CLIENT_ID'))
    out.setdefault('client_secret', os.getenv('GOOGLE_ADS_CLIENT_SECRET'))
    out.setdefault('developer_token', os.getenv('GOOGLE_ADS_DEVELOPER_TOKEN'))
    return out
