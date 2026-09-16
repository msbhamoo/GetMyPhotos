"""S3-compatible object storage (Cloudflare R2 in prod, MinIO locally)."""
import boto3
from botocore.config import Config

from app.core.config import settings

def _client(endpoint: str):
    is_aws = "amazonaws.com" in (endpoint or "")
    cfg = Config(signature_version="s3v4") if is_aws else Config(signature_version="s3v4", s3={"addressing_style": "path"})
    region = settings.s3_region if is_aws else (settings.s3_region or "auto")
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=region,
        config=cfg,
    )


_internal = _client(settings.s3_endpoint)
# Presigned URLs embed the host in the signature, so sign with the browser-facing endpoint.
_public = _client(settings.s3_public_endpoint or settings.s3_endpoint)
BUCKET = settings.s3_bucket


def key_web(event_id, photo_id) -> str:
    return f"events/{event_id}/web/{photo_id}"


def key_thumb(event_id, photo_id) -> str:
    return f"events/{event_id}/thumb/{photo_id}"


def key_zip(event_id, token) -> str:
    return f"events/{event_id}/zip/{token}.zip"


def presign_put(key: str, content_type: str, expires: int = 3600) -> str:
    return _public.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key, "ContentType": content_type},
        ExpiresIn=expires,
    )


def presign_get(key: str, expires: int = 3600, download_name: str | None = None) -> str:
    params = {"Bucket": BUCKET, "Key": key}
    if download_name:
        params["ResponseContentDisposition"] = f'attachment; filename="{download_name}"'
    return _public.generate_presigned_url("get_object", Params=params, ExpiresIn=expires)


def get_bytes(key: str) -> bytes:
    return _internal.get_object(Bucket=BUCKET, Key=key)["Body"].read()


def upload_file(path: str, key: str, content_type: str) -> None:
    _internal.upload_file(path, BUCKET, key, ExtraArgs={"ContentType": content_type})


def delete_prefix(prefix: str) -> int:
    deleted = 0
    paginator = _internal.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=BUCKET, Prefix=prefix):
        objs = [{"Key": o["Key"]} for o in page.get("Contents", [])]
        if objs:
            _internal.delete_objects(Bucket=BUCKET, Delete={"Objects": objs, "Quiet": True})
            deleted += len(objs)
    return deleted
