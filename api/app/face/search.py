"""Selfie → embedding → matches, always scoped to a single event."""
import numpy as np

from app.core.errors import AppError
from app.face.engine import decode_image, get_engine

SEARCH_SQL = """
SELECT f.photo_id::text AS photo_id, MIN(f.embedding <=> %(q)s) AS d
FROM faces f
JOIN photos p ON p.id = f.photo_id AND p.status = 'done'
WHERE f.event_id = %(event_id)s
GROUP BY f.photo_id
HAVING MIN(f.embedding <=> %(q)s) < %(cutoff)s
ORDER BY d
LIMIT 500
"""


def embed_selfie(data: bytes) -> np.ndarray:
    """Runs in a threadpool. The image bytes are never persisted."""
    try:
        img = decode_image(data, max_side=1024)
    except ValueError:
        raise AppError("BAD_IMAGE", 400)
    faces = get_engine().detect(img, min_score=0.5, min_size=60)
    if not faces:
        raise AppError("NO_FACE", 422)
    faces.sort(key=lambda f: f.size_px, reverse=True)
    # Two similarly large faces: we can't know which one is the guest
    if len(faces) > 1 and faces[1].size_px > 0.7 * faces[0].size_px:
        raise AppError("MULTIPLE_FACES", 422)
    return faces[0].embedding
