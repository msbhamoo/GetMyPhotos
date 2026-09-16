"""Printable QR card for the event table / invitation."""
import io

import qrcode
from PIL import Image, ImageDraw, ImageFont

MARIGOLD = (245, 166, 35)
DEEP_RED = (140, 20, 30)
CREAM = (255, 248, 235)
GOLD = (201, 162, 39)


def _font(size: int):
    return ImageFont.load_default(size=size)


def _center(draw: ImageDraw.ImageDraw, y: int, text: str, font, fill, width: int):
    w = draw.textlength(text, font=font)
    draw.text(((width - w) / 2, y), text, font=font, fill=fill)


def render_card(title: str, url: str, code: str, has_pin: bool, date_label: str = "") -> bytes:
    W, H = 1080, 1500
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)

    d.rectangle([0, 0, W, 260], fill=DEEP_RED)
    d.rectangle([0, 260, W, 272], fill=GOLD)
    _center(d, 60, title[:34], _font(64), CREAM, W)
    if date_label:
        _center(d, 160, date_label, _font(40), (255, 220, 170), W)

    _center(d, 320, "Apni saari photos paao!", _font(58), DEEP_RED, W)

    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=2, box_size=20)
    qr.add_data(url)
    qr.make(fit=True)
    q = qr.make_image(fill_color="black", back_color="white").convert("RGB").resize((680, 680))
    d.rounded_rectangle([180, 420, 900, 1140], radius=28, fill="white", outline=MARIGOLD, width=12)
    img.paste(q, (200, 440))

    _center(d, 1180, "1. Scan karo   2. Selfie lo   3. Photos paao", _font(40), (60, 40, 30), W)
    _center(d, 1250, f"Code: {code}", _font(56), DEEP_RED, W)
    if has_pin:
        _center(d, 1320, "PIN ke liye host se poochein", _font(36), (90, 70, 60), W)

    d.rectangle([0, H - 110, W, H], fill=MARIGOLD)
    _center(d, H - 88, "GetMyPhotos  ·  App ki zaroorat nahi", _font(40), DEEP_RED, W)

    buf = io.BytesIO()
    img.save(buf, "PNG", optimize=True)
    return buf.getvalue()
