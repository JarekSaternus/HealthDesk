import hashlib

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Download

router = APIRouter(prefix="/api", tags=["downloads"])


class DownloadIn(BaseModel):
    platform: str  # windows, macos, linux
    source: str | None = None  # utm_source
    language: str | None = None  # browser lang


def _ip_hash(request: Request) -> str:
    ip = request.client.host if request.client else "unknown"
    return hashlib.sha256(ip.encode()).hexdigest()


@router.post("/downloads")
def log_download(data: DownloadIn, request: Request, db: Session = Depends(get_db)):
    """Log a download event from the landing page."""
    dl = Download(
        platform=data.platform,
        source=data.source,
        language=data.language,
        ip_hash=_ip_hash(request),
    )
    db.add(dl)
    db.commit()
    return {"status": "ok"}
