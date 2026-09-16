from app.core.utils import (
    CODE_ALPHABET,
    STRICTNESS,
    bucket_matches,
    event_code,
    mask_phone,
    normalize_phone,
    strictness_for,
)


def test_normalize_phone_variants():
    assert normalize_phone("9876543210") == "+919876543210"
    assert normalize_phone("+91 98765 43210") == "+919876543210"
    assert normalize_phone("919876543210") == "+919876543210"
    assert normalize_phone("09876543210") == "+919876543210"


def test_normalize_phone_rejects_invalid():
    assert normalize_phone("12345") is None
    assert normalize_phone("5876543210") is None  # Indian mobiles start 6-9
    assert normalize_phone("") is None


def test_mask_phone_hides_middle():
    assert mask_phone("+919876543210") == "+91XXXXXX3210"


def test_event_code_uses_unambiguous_alphabet():
    for _ in range(200):
        code = event_code()
        assert len(code) == 7
        assert set(code) <= set(CODE_ALPHABET)
    assert not set("0O1I") & set(CODE_ALPHABET)


def test_bucket_matches_splits_confident_and_maybe():
    rows = [("a", 0.30), ("b", 0.54), ("c", 0.58), ("d", 0.70)]
    matches, maybe = bucket_matches(rows, 0.55)
    assert [m[0] for m in matches] == ["a", "b"]
    assert [m[0] for m in maybe] == ["c"]


def test_strictness_roundtrip():
    for name, value in STRICTNESS.items():
        assert strictness_for(value) == name
