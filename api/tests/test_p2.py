import numpy as np

from app.core.crypto import decrypt_embedding, encrypt_embedding
from app.core.utils import hmac_sha256_hex, parse_wa_ref, signature_ok


def test_embedding_encryption_roundtrip():
    emb = np.random.rand(512).astype(np.float32)
    blob = encrypt_embedding(emb)
    assert emb.tobytes() not in blob  # never stored in the clear
    assert np.array_equal(decrypt_embedding(blob), emb)


def test_encryption_uses_fresh_nonce():
    emb = np.zeros(512, dtype=np.float32)
    assert encrypt_embedding(emb) != encrypt_embedding(emb)


def test_razorpay_style_signature():
    secret = "s3cret"
    sig = hmac_sha256_hex(secret, "order_1|pay_1")
    assert signature_ok(secret, "order_1|pay_1", sig)
    assert not signature_ok(secret, "order_1|pay_2", sig)
    assert not signature_ok("", "order_1|pay_1", sig)
    assert not signature_ok(secret, "order_1|pay_1", None)


def test_parse_wa_ref():
    assert parse_wa_ref("PHOTOS ABC234") == "ABC234"
    assert parse_wa_ref("  photos   xyz789 please") == "XYZ789"
    assert parse_wa_ref("hello") is None
    assert parse_wa_ref("PHOTOS AB") is None
