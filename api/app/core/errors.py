from fastapi import Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    """Error with a stable code; clients translate `message_key` into the user's language."""

    def __init__(self, code: str, status: int = 400, message_key: str | None = None):
        super().__init__(code)
        self.code = code
        self.status = status
        self.message_key = message_key or f"err.{code.lower()}"


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content={"error": {"code": exc.code, "message_key": exc.message_key}},
    )
