"""MongoDB collection for workspace integration credentials (formerly ``services``)."""

from __future__ import annotations


def integration_configs_collection(db):
    names = db.list_collection_names()
    if 'integrations' in names:
        return db.integrations
    return db.services
