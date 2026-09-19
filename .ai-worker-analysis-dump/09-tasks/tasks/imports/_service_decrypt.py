"""Decrypt API `integrations.configuration` blobs (AES-256-CBC), matching apps/api/src/models/Integration.js."""

import json
import os
from typing import Any, Dict

from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad


def decrypt_service_configuration(text: str) -> Dict[str, Any]:
    if not text or ':' not in text:
        return {}
    app_key = (os.getenv('APP_KEY') or 'agentmarket-default-key-32bytes!!')[:32]
    key = app_key.encode('utf-8')
    if len(key) < 32:
        key = key.ljust(32, b'\0')
    try:
        iv_hex, enc_hex = text.split(':', 1)
        iv = bytes.fromhex(iv_hex)
        enc = bytes.fromhex(enc_hex)
        cipher = AES.new(key, AES.MODE_CBC, iv)
        raw = unpad(cipher.decrypt(enc), AES.block_size)
        return json.loads(raw.decode('utf-8'))
    except Exception:
        return {}
