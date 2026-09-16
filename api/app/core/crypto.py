"""AES-256-GCM encryption for guest face codes (embeddings) at rest."""
import base64
import hashlib
import os

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings

_AAD = b"gmp-face-v1"


def _key() -> bytes:
    if settings.face_key:
        key = base64.b64decode(settings.face_key)
        if len(key) != 32:
            raise RuntimeError("FACE_KEY must be 32 bytes, base64-encoded")
        return key
    if not settings.is_dev:
        raise RuntimeError("FACE_KEY is required outside dev")
    return hashlib.sha256(b"gmp-dev-face-key:" + settings.jwt_secret.encode()).digest()


def encrypt_embedding(embedding) -> bytes:
    nonce = os.urandom(12)
    raw = np.asarray(embedding, dtype=np.float32).tobytes()
    return nonce + AESGCM(_key()).encrypt(nonce, raw, _AAD)


def decrypt_embedding(blob: bytes) -> np.ndarray:
    raw = AESGCM(_key()).decrypt(bytes(blob[:12]), bytes(blob[12:]), _AAD)
    return np.frombuffer(raw, dtype=np.float32)
