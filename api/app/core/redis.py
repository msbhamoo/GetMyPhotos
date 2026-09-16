import fakeredis
import fakeredis.aioredis
import redis.asyncio as aioredis
from redis import Redis
from rq import Queue

from app.core.config import settings

try:
    _sync = Redis.from_url(settings.redis_url, socket_connect_timeout=1)
    _sync.ping()
    aredis = aioredis.from_url(settings.redis_url, decode_responses=True)
except Exception:
    _server = fakeredis.FakeServer()
    _sync = fakeredis.FakeRedis(server=_server)
    aredis = fakeredis.aioredis.FakeRedis(server=_server, decode_responses=True)

face_queue = Queue("face", connection=_sync)
media_queue = Queue("media", connection=_sync)
default_queue = Queue("default", connection=_sync)
notify_queue = Queue("notify", connection=_sync)


def sync_redis() -> Redis:
    return _sync

