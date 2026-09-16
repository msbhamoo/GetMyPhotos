import asyncio
import logging
import sys
from contextlib import asynccontextmanager

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.db import pool
from app.core.errors import AppError, app_error_handler
from app.routers import auth, billing, events, guest, invites, public, uploads, whatsapp

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await pool.open()
    yield
    await pool.close()


app = FastAPI(
    title="GetMyPhotos API",
    version="0.2.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.is_dev else None,
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_exception_handler(AppError, app_error_handler)

for r in (
    auth.router,
    events.router,
    uploads.router,
    invites.router,
    billing.router,
    public.router,
    guest.router,
    whatsapp.router,
):
    app.include_router(r, prefix="/v1")


@app.get("/health")
async def health():
    return {"ok": True}
