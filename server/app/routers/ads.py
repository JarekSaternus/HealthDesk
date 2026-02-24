import hashlib
import random

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Ad, AdImpression

router = APIRouter(prefix="/api/ads", tags=["ads"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class AdEventIn(BaseModel):
    ad_id: int
    event_type: str
    client_uuid: str


class AdOut(BaseModel):
    id: int
    title: str
    text: str
    url: str
    bg: str
    accent: str
    is_affiliate: bool

    class Config:
        from_attributes = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ip_hash(request: Request) -> str:
    ip = request.client.host if request.client else "unknown"
    return hashlib.sha256(ip.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[AdOut])
def get_active_ads(db: Session = Depends(get_db)):
    """Return active ads in weighted random order."""
    ads = db.query(Ad).filter(Ad.is_active == True).all()  # noqa: E712
    if not ads:
        return []

    # Weighted shuffle: build weighted list then shuffle
    weighted: list[Ad] = []
    for ad in ads:
        weighted.extend([ad] * max(ad.weight, 1))
    random.shuffle(weighted)

    # Deduplicate while preserving weighted-random order
    seen: set[int] = set()
    result: list[Ad] = []
    for ad in weighted:
        if ad.id not in seen:
            seen.add(ad.id)
            result.append(ad)

    return result


@router.post("/event")
def log_ad_event(event: AdEventIn, request: Request, db: Session = Depends(get_db)):
    """Log an ad impression or click event."""
    if event.event_type not in ("impression", "click"):
        raise HTTPException(
            status_code=422,
            detail="event_type must be 'impression' or 'click'",
        )

    # Verify ad exists
    ad = db.query(Ad).filter(Ad.id == event.ad_id).first()
    if not ad:
        raise HTTPException(status_code=404, detail="Ad not found")

    impression = AdImpression(
        ad_id=event.ad_id,
        event_type=event.event_type,
        client_uuid=event.client_uuid,
        ip_hash=_ip_hash(request),
    )
    db.add(impression)
    db.commit()

    return {"status": "ok"}
