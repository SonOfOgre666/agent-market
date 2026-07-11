"""Shared Twitter app credentials from Mongo `services` (matches API Service model)."""

from lib.integration_config import integration_configs_collection
from ._service_decrypt import decrypt_service_configuration


def get_twitter_service_configuration(db) -> dict:
    doc = integration_configs_collection(db).find_one({'name': 'twitter'})
    if not doc or not doc.get('configuration'):
        return {}
    return decrypt_service_configuration(doc['configuration'])
