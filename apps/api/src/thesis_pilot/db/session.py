from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from thesis_pilot.core.config import Settings


def create_session_factory(settings: Settings) -> sessionmaker[Session]:
    url = settings.database_url.get_secret_value()
    connect_args = (
        {"check_same_thread": False} if url.startswith("sqlite:") else {"connect_timeout": 3}
    )
    engine = create_engine(url, pool_pre_ping=True, connect_args=connect_args, hide_parameters=True)
    return sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)
