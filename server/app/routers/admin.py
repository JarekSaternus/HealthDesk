from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..auth import (
    ADMIN_PASSWORD_HASH,
    create_access_token,
    get_current_admin,
    verify_password,
)
from ..database import get_db
from ..models import Ad, AdImpression, Download, TelemetryEvent

router = APIRouter(prefix="/admin", tags=["admin"])

templates = Jinja2Templates(directory="app/templates")

# ---------------------------------------------------------------------------
# Login / Logout
# ---------------------------------------------------------------------------


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request, "error": None})


@router.post("/login", response_class=HTMLResponse)
def login_action(request: Request, password: str = Form(...)):
    if not verify_password(password, ADMIN_PASSWORD_HASH):
        return templates.TemplateResponse(
            "login.html", {"request": request, "error": "Nieprawidlowe haslo"}
        )

    token = create_access_token({"sub": "admin"})
    response = RedirectResponse(url="/admin/ads", status_code=303)
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=86400,
    )
    return response


@router.get("/logout")
def logout():
    response = RedirectResponse(url="/admin/login", status_code=303)
    response.delete_cookie("access_token")
    return response


# ---------------------------------------------------------------------------
# Ads management
# ---------------------------------------------------------------------------


@router.get("/ads", response_class=HTMLResponse)
def ads_list(
    request: Request,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    ads = db.query(Ad).order_by(Ad.created_at.desc()).all()

    # Gather impression/click counts per ad
    ads_data = []
    for ad in ads:
        impressions = (
            db.query(func.count(AdImpression.id))
            .filter(AdImpression.ad_id == ad.id, AdImpression.event_type == "impression")
            .scalar()
        )
        clicks = (
            db.query(func.count(AdImpression.id))
            .filter(AdImpression.ad_id == ad.id, AdImpression.event_type == "click")
            .scalar()
        )
        ads_data.append(
            {
                "ad": ad,
                "impressions": impressions or 0,
                "clicks": clicks or 0,
            }
        )

    return templates.TemplateResponse(
        "ads_list.html", {"request": request, "ads_data": ads_data}
    )


@router.get("/ads/new", response_class=HTMLResponse)
def ads_new_form(
    request: Request,
    _admin=Depends(get_current_admin),
):
    return templates.TemplateResponse(
        "ads_form.html",
        {"request": request, "ad": None, "form_action": "/admin/ads"},
    )


@router.post("/ads")
def ads_create(
    request: Request,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
    title: str = Form(...),
    text: str = Form(...),
    url: str = Form(...),
    bg: str = Form("#1a1a2e"),
    accent: str = Form("#2ecc71"),
    is_affiliate: bool = Form(False),
    weight: int = Form(1),
):
    ad = Ad(
        title=title,
        text=text,
        url=url,
        bg=bg,
        accent=accent,
        is_affiliate=is_affiliate,
        weight=weight,
    )
    db.add(ad)
    db.commit()
    return RedirectResponse(url="/admin/ads", status_code=303)


@router.get("/ads/{ad_id}/edit", response_class=HTMLResponse)
def ads_edit_form(
    ad_id: int,
    request: Request,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        return RedirectResponse(url="/admin/ads", status_code=303)

    return templates.TemplateResponse(
        "ads_form.html",
        {
            "request": request,
            "ad": ad,
            "form_action": f"/admin/ads/{ad_id}/edit",
        },
    )


@router.post("/ads/{ad_id}/edit")
def ads_update(
    ad_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
    title: str = Form(...),
    text: str = Form(...),
    url: str = Form(...),
    bg: str = Form("#1a1a2e"),
    accent: str = Form("#2ecc71"),
    is_affiliate: bool = Form(False),
    weight: int = Form(1),
):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if not ad:
        return RedirectResponse(url="/admin/ads", status_code=303)

    ad.title = title
    ad.text = text
    ad.url = url
    ad.bg = bg
    ad.accent = accent
    ad.is_affiliate = is_affiliate
    ad.weight = weight
    db.commit()

    return RedirectResponse(url="/admin/ads", status_code=303)


@router.post("/ads/{ad_id}/delete")
def ads_delete(
    ad_id: int,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    ad = db.query(Ad).filter(Ad.id == ad_id).first()
    if ad:
        ad.is_active = False
        db.commit()
    return RedirectResponse(url="/admin/ads", status_code=303)


# ---------------------------------------------------------------------------
# Telemetry dashboard
# ---------------------------------------------------------------------------


@router.get("/telemetry", response_class=HTMLResponse)
def telemetry_dashboard(
    request: Request,
    db: Session = Depends(get_db),
    _admin=Depends(get_current_admin),
):
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = today_start - timedelta(days=7)
    month_ago = today_start - timedelta(days=30)

    # DAU — distinct client_uuids today
    dau = (
        db.query(func.count(func.distinct(TelemetryEvent.client_uuid)))
        .filter(TelemetryEvent.timestamp >= today_start)
        .scalar()
        or 0
    )

    # WAU — distinct client_uuids last 7 days
    wau = (
        db.query(func.count(func.distinct(TelemetryEvent.client_uuid)))
        .filter(TelemetryEvent.timestamp >= week_ago)
        .scalar()
        or 0
    )

    # MAU — distinct client_uuids last 30 days
    mau = (
        db.query(func.count(func.distinct(TelemetryEvent.client_uuid)))
        .filter(TelemetryEvent.timestamp >= month_ago)
        .scalar()
        or 0
    )

    # Total events today
    events_today = (
        db.query(func.count(TelemetryEvent.id))
        .filter(TelemetryEvent.timestamp >= today_start)
        .scalar()
        or 0
    )

    # Events per day (last 30 days) for chart
    # SQLite date function: date(timestamp)
    daily_events = (
        db.query(
            func.date(TelemetryEvent.timestamp).label("day"),
            func.count(TelemetryEvent.id).label("count"),
        )
        .filter(TelemetryEvent.timestamp >= month_ago)
        .group_by(func.date(TelemetryEvent.timestamp))
        .order_by(func.date(TelemetryEvent.timestamp))
        .all()
    )
    chart_labels = [row.day for row in daily_events]
    chart_values = [row.count for row in daily_events]

    # Most common events
    common_events = (
        db.query(
            TelemetryEvent.event_type,
            func.count(TelemetryEvent.id).label("count"),
        )
        .group_by(TelemetryEvent.event_type)
        .order_by(func.count(TelemetryEvent.id).desc())
        .limit(10)
        .all()
    )

    # Downloads stats
    downloads_today = (
        db.query(func.count(Download.id))
        .filter(Download.timestamp >= today_start)
        .scalar()
        or 0
    )
    downloads_total = db.query(func.count(Download.id)).scalar() or 0
    downloads_by_platform = (
        db.query(
            Download.platform,
            func.count(Download.id).label("count"),
        )
        .group_by(Download.platform)
        .order_by(func.count(Download.id).desc())
        .all()
    )
    daily_downloads = (
        db.query(
            func.date(Download.timestamp).label("day"),
            func.count(Download.id).label("count"),
        )
        .filter(Download.timestamp >= month_ago)
        .group_by(func.date(Download.timestamp))
        .order_by(func.date(Download.timestamp))
        .all()
    )
    dl_chart_labels = [row.day for row in daily_downloads]
    dl_chart_values = [row.count for row in daily_downloads]

    # App versions in use
    app_versions = (
        db.query(
            TelemetryEvent.app_version,
            func.count(func.distinct(TelemetryEvent.client_uuid)).label("users"),
        )
        .filter(TelemetryEvent.app_version.isnot(None))
        .group_by(TelemetryEvent.app_version)
        .order_by(func.count(func.distinct(TelemetryEvent.client_uuid)).desc())
        .limit(10)
        .all()
    )

    return templates.TemplateResponse(
        "telemetry_dashboard.html",
        {
            "request": request,
            "dau": dau,
            "wau": wau,
            "mau": mau,
            "events_today": events_today,
            "chart_labels": chart_labels,
            "chart_values": chart_values,
            "common_events": common_events,
            "app_versions": app_versions,
            "downloads_today": downloads_today,
            "downloads_total": downloads_total,
            "downloads_by_platform": downloads_by_platform,
            "dl_chart_labels": dl_chart_labels,
            "dl_chart_values": dl_chart_values,
        },
    )
