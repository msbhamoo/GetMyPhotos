import sys
from app.core.redis import sync_redis
from rq import Queue, SimpleWorker

if __name__ == "__main__":
    redis_conn = sync_redis()
    worker = SimpleWorker(["face", "media", "notify", "default"], connection=redis_conn)
    worker.work(with_scheduler=False)
