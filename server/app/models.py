from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from .database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Ad(Base):
    __tablename__ = "ads"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    text = Column(Text, nullable=False)
    url = Column(String(500), nullable=False)
    bg = Column(String(20), nullable=False, default="#1a1a2e")
    accent = Column(String(20), nullable=False, default="#2ecc71")
    is_active = Column(Boolean, default=True, nullable=False)
    is_affiliate = Column(Boolean, default=False, nullable=False)
    weight = Column(Integer, default=1, nullable=False)
    created_at = Column(DateTime, default=_utcnow, nullable=False)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow, nullable=False)

    impressions = relationship("AdImpression", back_populates="ad", lazy="dynamic")


class AdImpression(Base):
    __tablename__ = "ad_impressions"

    id = Column(Integer, primary_key=True, index=True)
    ad_id = Column(Integer, ForeignKey("ads.id"), nullable=False, index=True)
    event_type = Column(String(20), nullable=False)  # "impression" or "click"
    client_uuid = Column(String(64), nullable=False)
    timestamp = Column(DateTime, default=_utcnow, nullable=False)
    ip_hash = Column(String(64), nullable=False)

    ad = relationship("Ad", back_populates="impressions")


class TelemetryEvent(Base):
    __tablename__ = "telemetry_events"

    id = Column(Integer, primary_key=True, index=True)
    client_uuid = Column(String(64), nullable=False, index=True)
    event_type = Column(String(50), nullable=False, index=True)
    payload = Column(Text, nullable=True)  # JSON text
    app_version = Column(String(20), nullable=True)
    os_version = Column(String(50), nullable=True)
    timestamp = Column(DateTime, default=_utcnow, nullable=False, index=True)
    ip_hash = Column(String(64), nullable=False)
