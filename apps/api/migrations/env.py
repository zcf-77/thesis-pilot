from alembic import context
from sqlalchemy import create_engine, pool

from thesis_pilot.core.config import get_settings
from thesis_pilot.db.base import Base
from thesis_pilot.db.models import register_models

register_models()
target_metadata = Base.metadata
url = get_settings().database_url.get_secret_value()

if context.is_offline_mode():
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()
else:
    supplied_connection = context.config.attributes.get("connection")
    if supplied_connection is not None:
        context.configure(
            connection=supplied_connection, target_metadata=target_metadata, compare_type=True
        )
        with context.begin_transaction():
            context.run_migrations()
    else:
        engine = create_engine(url, poolclass=pool.NullPool, hide_parameters=True)
        try:
            with engine.connect() as connection:
                context.configure(
                    connection=connection, target_metadata=target_metadata, compare_type=True
                )
                with context.begin_transaction():
                    context.run_migrations()
        finally:
            engine.dispose()
