"""Face detection + embedding behind a small interface so the model can be swapped.

Default: InsightFace SCRFD detector + ArcFace (buffalo_l) on ONNX Runtime CPU.
LICENSE: InsightFace pretrained weights are non-commercial. Obtain a commercial
license or swap the model before paid launch (docs/SPEC.md §7.1).
"""
import threading
from dataclasses import dataclass

import cv2
import numpy as np

from app.core.config import settings


@dataclass
class DetectedFace:
    bbox: list[float]  # x, y, w, h normalized to image size
    det_score: float
    size_px: float  # shorter side of the face box in pixels
    embedding: np.ndarray  # 512-d, L2-normalized float32


class FaceEngine:
    def __init__(self, model_name: str, det_size: int):
        from insightface.app import FaceAnalysis

        self._app = FaceAnalysis(
            name=model_name,
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        self._app.prepare(ctx_id=-1, det_size=(det_size, det_size))

    def detect(self, img: np.ndarray, min_score: float = 0.6, min_size: int = 40) -> list[DetectedFace]:
        h, w = img.shape[:2]
        out = []
        for f in self._app.get(img):
            x1, y1, x2, y2 = (float(v) for v in f.bbox)
            fw, fh = x2 - x1, y2 - y1
            if f.det_score < min_score or min(fw, fh) < min_size:
                continue
            out.append(
                DetectedFace(
                    bbox=[x1 / w, y1 / h, fw / w, fh / h],
                    det_score=float(f.det_score),
                    size_px=min(fw, fh),
                    embedding=f.normed_embedding.astype(np.float32),
                )
            )
        return out


_engine: FaceEngine | None = None
_lock = threading.Lock()


def get_engine() -> FaceEngine:
    global _engine
    if _engine is None:
        with _lock:
            if _engine is None:
                _engine = FaceEngine(settings.face_model, settings.face_det_size)
    return _engine


def decode_image(data: bytes, max_side: int = 1600) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("undecodable image")
    h, w = img.shape[:2]
    scale = max_side / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img
