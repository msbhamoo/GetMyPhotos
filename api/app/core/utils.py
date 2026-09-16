"""Dependency-free helpers (unit tested)."""
import hashlib
import hmac
import re
import secrets

# No 0/O/1/I so codes survive being read aloud or handwritten
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
# Guest UI languages. mr/te/ta/gu translations exist and can be re-enabled here.
LANGS = ("en", "hi", "bn")
DEFAULT_LANG = "en"
STRICTNESS = {"strict": 0.48, "normal": 0.55, "loose": 0.62}
MAYBE_MARGIN = 0.07


def normalize_phone(raw: str) -> str | None:
    """Return an Indian mobile number in E.164 (+91XXXXXXXXXX) or None."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 10 and digits[0] in "6789":
        return "+91" + digits
    return None


def mask_phone(phone: str) -> str:
    return phone[:3] + "XXXXXX" + phone[-4:] if len(phone) >= 7 else "XXXX"


def event_code(length: int = 7) -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def sha256(value: str | bytes) -> bytes:
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).digest()


def hmac_sha256_hex(secret: str, message: str | bytes) -> str:
    if isinstance(message, str):
        message = message.encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def signature_ok(secret: str, message: str | bytes, signature: str | None) -> bool:
    return bool(secret and signature) and hmac.compare_digest(hmac_sha256_hex(secret, message), signature)


WA_REF_RE = re.compile(r"\bPHOTOS\s+([A-Z0-9]{6})\b")


def parse_wa_ref(text: str) -> str | None:
    m = WA_REF_RE.search((text or "").upper())
    return m.group(1) if m else None


def strictness_for(threshold: float) -> str:
    return min(STRICTNESS, key=lambda k: abs(STRICTNESS[k] - threshold))


def bucket_matches(rows: list[tuple[str, float]], threshold: float) -> tuple[list, list]:
    """Split (photo_id, distance) rows into confident matches and 'maybe' matches."""
    matches, maybe = [], []
    for photo_id, dist in rows:
        if dist < threshold:
            matches.append((photo_id, dist))
        elif dist < threshold + MAYBE_MARGIN:
            maybe.append((photo_id, dist))
    return matches, maybe
