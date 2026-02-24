import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import TelemetryEvent

router = APIRouter(prefix="/api", tags=["telemetry"])

VALID_EVENT_TYPES = {
    "app_start",
    "app_stop",
    "break_taken",
    "break_skipped",
    "water_logged",
    "exercise_done",
    "audio_play",
    "error",
}

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class TelemetryIn(BaseModel):
    client_uuid: str
    event_type: str
    payload: dict | None = None
    app_version: str | None = None
    os_version: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ip_hash(request: Request) -> str:
    ip = request.client.host if request.client else "unknown"
    return hashlib.sha256(ip.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/events")
def log_event(event: TelemetryIn, request: Request, db: Session = Depends(get_db)):
    """Log a telemetry event from the desktop client."""
    if event.event_type not in VALID_EVENT_TYPES:
        raise HTTPException(
            status_code=422,
            detail=f"event_type must be one of: {', '.join(sorted(VALID_EVENT_TYPES))}",
        )

    telemetry = TelemetryEvent(
        client_uuid=event.client_uuid,
        event_type=event.event_type,
        payload=json.dumps(event.payload) if event.payload else None,
        app_version=event.app_version,
        os_version=event.os_version,
        ip_hash=_ip_hash(request),
    )
    db.add(telemetry)
    db.commit()

    return {"status": "ok"}
