from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "dev"
    database_url: str = "postgresql://gmp:gmp@localhost:5432/gmp"
    redis_url: str = "redis://localhost:6379/0"
    jwt_secret: str = "change-me"
    access_ttl_min: int = 15
    refresh_ttl_days: int = 60
    cors_origins: str = "http://localhost:5173,http://localhost:5174"
    guest_base_url: str = "http://localhost:5173"
    dashboard_base_url: str = "http://localhost:5174"
    consent_version: str = "2026-09-v1"
    profile_consent_version: str = "2026-09-p1"
    face_key: str = ""

    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    extend_price_paise: int = 19900
    extend_days: int = 275  # 90-day pass + 275 = 1 year

    s3_endpoint: str = "http://localhost:9000"
    s3_public_endpoint: str = ""
    s3_access_key: str = "minio"
    s3_secret_key: str = "minio12345"
    s3_bucket: str = "getmyphotos"
    s3_region: str = "eu-north-1"

    dev_otp: bool = True
    wa_token: str = ""
    wa_phone_number_id: str = ""
    wa_otp_template: str = "otp_code"
    wa_invite_template: str = "event_invite"
    wa_new_photos_template: str = "new_photos"
    wa_business_number: str = ""
    wa_verify_token: str = ""
    wa_app_secret: str = ""
    msg91_auth_key: str = ""
    msg91_template_id: str = ""

    face_model: str = "buffalo_l"
    face_det_size: int = 640

    @property
    def is_dev(self) -> bool:
        return self.env == "dev"

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
