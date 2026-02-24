import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Database path relative to server root (server/data/healthdesk_api.db)
SERVER_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = SERVER_ROOT / "data"
DATABASE_URL = f"sqlite:///{DATA_DIR / 'healthdesk_api.db'}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    """FastAPI dependency that yields a database session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
