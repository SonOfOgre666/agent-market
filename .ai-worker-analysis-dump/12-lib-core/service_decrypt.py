"""Decrypt ``integrations.configuration`` blobs (AES-256-CBC) — parity with ``apps/api/src/models/Integration.js``."""

from __future__ import annotations

import json
import os
from binascii import unhexlify

from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad


def _app_key_bytes() -> bytes:
    key = (os.getenv('APP_KEY') or 'agentmarket-default-key-32bytes!!')[:32]
    return key.encode('utf-8')


def decrypt_configuration(encrypted: str | None) -> dict:
    if not encrypted or ':' not in encrypted:
        return {}
    try:
        iv_hex, enc_hex = encrypted.split(':', 1)
        iv = unhexlify(iv_hex)
        enc = unhexlify(enc_hex)
        cipher = AES.new(_app_key_bytes(), AES.MODE_CBC, iv)
        decrypted = cipher.decrypt(enc)
        body = unpad(decrypted, AES.block_size)
        return json.loads(body.decode('utf-8'))
    except Exception:
        return {}
