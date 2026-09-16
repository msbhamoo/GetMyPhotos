from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.core.config import settings

pool = ConnectionPool(
    settings.database_url,
    min_size=1,
    max_size=4,
    configure=register_vector,
    kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None},
    open=True,
)
