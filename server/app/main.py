from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import DATA_DIR, Base, engine
from .routers import admin, ads, telemetry


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure data directory exists and create tables
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="HealthDesk API", lifespan=lifespan)

# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------

app.include_router(ads.router)
app.include_router(telemetry.router)
app.include_router(admin.router)

# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------


@app.get("/")
def health_check():
    return {"status": "ok", "service": "HealthDesk API"}
