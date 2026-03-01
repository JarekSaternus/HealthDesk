import hashlib
import os
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, HTTPException, Request, status
from jose import JWTError, jwt

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SECRET_KEY = os.environ.get("API_SECRET_KEY", "dev-secret-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 24

# Simple SHA256-based password hashing (no bcrypt dependency issues)
_SALT = "healthdesk-api-salt-2026"


def _hash_password(password: str) -> str:
    return hashlib.sha256(f"{_SALT}{password}".encode()).hexdigest()


# Admin password hash — set via env or fall back to hash of "admin"
ADMIN_PASSWORD_HASH = os.environ.get(
    "ADMIN_PASSWORD_HASH",
    _hash_password("admin"),
)

# ---------------------------------------------------------------------------
# Password helpers
# ---------------------------------------------------------------------------


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return _hash_password(plain_password) == hashed_password


def get_password_hash(password: str) -> str:
    return _hash_password(password)


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS)
    )
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> dict:
    """Decode and verify a JWT token. Raises JWTError on failure."""
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------


def get_current_admin(request: Request):
    """Dependency that checks for a valid JWT in the 'access_token' cookie.

    Raises HTTP 303 redirect to login page if not authenticated.
    """
    token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_303_SEE_OTHER,
            headers={"Location": "/admin/login"},
        )
    try:
        payload = verify_token(token)
        if payload.get("sub") != "admin":
            raise JWTError("invalid subject")
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_303_SEE_OTHER,
            headers={"Location": "/admin/login"},
        )
    return payload
