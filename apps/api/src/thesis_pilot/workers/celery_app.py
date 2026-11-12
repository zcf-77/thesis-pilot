from celery import Celery

from thesis_pilot.core.config import Settings, get_settings

TASK_NAME = "thesis_pilot.diagnostic"


def create_celery(settings: Settings) -> Celery:
    app = Celery(
        "thesis_pilot",
        broker=settings.redis_url.get_secret_value(),
        include=["thesis_pilot.workers.tasks"],
    )
    app.conf.update(
        task_serializer="json",
        accept_content=["json"],
        result_serializer="json",
        task_ignore_result=True,
        task_acks_late=True,
        task_reject_on_worker_lost=True,
        worker_prefetch_multiplier=1,
        broker_connection_retry_on_startup=True,
        broker_connection_timeout=3,
        broker_transport_options={"socket_connect_timeout": 3, "socket_timeout": 3},
        task_default_queue="thesis_pilot",
        timezone="UTC",
        enable_utc=True,
    )
    return app


app = create_celery(get_settings())
