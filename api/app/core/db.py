from pgvector.psycopg import register_vector_async
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

from app.core.config import settings


async def _configure(conn):
    await register_vector_async(conn)


pool = AsyncConnectionPool(
    settings.database_url,
    open=False,
    min_size=1,
    max_size=10,
    configure=_configure,
    kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None},
)


async def get_conn():
    async with pool.connection() as conn:
        yield conn
