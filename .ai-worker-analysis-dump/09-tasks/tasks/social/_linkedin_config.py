"""LinkedIn app credentials from Mongo ``integrations`` (matches API Integration model)."""

from lib.integration_config import integration_configs_collection
from ..imports._service_decrypt import decrypt_service_configuration


def get_linkedin_service_configuration(db, workspace_id=None) -> dict:
    coll = integration_configs_collection(db)
    q = {'name': 'linkedin'}
    doc = None
    if workspace_id:
        doc = coll.find_one({**q, 'workspace_id': workspace_id})
    if not doc:
        doc = coll.find_one(q)
    if not doc or not doc.get('configuration'):
        return {}
    return decrypt_service_configuration(doc['configuration'])
