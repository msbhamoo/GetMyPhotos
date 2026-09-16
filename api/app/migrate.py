"""Apply db/migrations/*.sql in order, once each. Run: python -m app.migrate"""
import logging
import os
from pathlib import Path

import psycopg

from app.core.config import settings

log = logging.getLogger("gmp.migrate")
DEFAULT_DIR = Path(__file__).resolve().parents[2] / "db" / "migrations"


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    directory = Path(os.environ.get("MIGRATIONS_DIR", DEFAULT_DIR))
    files = sorted(directory.glob("*.sql"))
    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())"
        )
        applied = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
        # Databases created before the runner existed already have the initial schema
        if not applied and conn.execute("SELECT to_regclass('public.events')").fetchone()[0]:
            conn.execute("INSERT INTO schema_migrations (name) VALUES ('0001_init.sql')")
            applied.add("0001_init.sql")
        for f in files:
            if f.name in applied:
                continue
            log.info("applying %s", f.name)
            with conn.transaction():
                conn.execute(f.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (f.name,))
    log.info("migrations up to date")


if __name__ == "__main__":
    main()
